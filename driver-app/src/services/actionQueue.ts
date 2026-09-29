/**
 * Offline action queue.
 *
 * Stop completions (with proof of delivery), failed stops, declared loads, SOS
 * details, parcel scans and the driver's own documents are kept on the phone when there is no signal and
 * sent, in the order they were made, when it is back. Every action carries its
 * own id, which is sent as the idempotency key, so one that reached the server
 * but whose reply was lost is not applied twice when it is sent again.
 *
 * The queue lives in AsyncStorage, so it survives the app being closed. Photos
 * and signatures are copied into the app's document folder so they are still
 * there when the action is finally sent.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { api, ApiError, type SosSeverity, type SosType } from './api';
import { sendDocument, type DocumentUpload } from './documentUpload';
import { uploadProofFiles, type PodPaths } from './podUpload';
import { isNetworkError } from '../utils/errors';

const STORAGE_KEY = 'action_queue_v1';
const FILES_DIR = `${FileSystem.documentDirectory ?? ''}action-queue/`;

export type FailureReasonCode = 'customer_unavailable' | 'address_unreachable' | 'customer_refused' | 'premises_closed' | 'other';

export interface Payloads {
  complete_stop: {
    stopId: string;
    receiverName: string;
    lat?: number;
    lng?: number;
    photoUri?: string | null;
    signatureUri?: string | null;
    /** Files already uploaded, so a retry does not upload them again. */
    uploaded?: PodPaths;
  };
  fail_stop: { stopId: string; reason: FailureReasonCode; note?: string; lat?: number; lng?: number };
  declare_load: { vehicleId: string; percentage: number };
  sos_details: { alertId: string; details: { alert_type?: SosType; description?: string; severity?: SosSeverity } };
  /** The driver's own document: every file is uploaded, then the document is recorded. */
  upload_document: DocumentUpload;
  scan: { code: string; purpose: 'pickup' | 'delivery'; stopId?: string; method: 'camera' | 'manual'; lat?: number; lng?: number };
}

export type ActionKind = keyof Payloads;

export type QueuedAction = {
  [K in ActionKind]: {
    /** Also the idempotency key. */
    id: string;
    kind: K;
    payload: Payloads[K];
    createdAt: number;
    attempts: number;
    /** Who made it, so one driver's queue is never sent as another. */
    driverId: string | null;
  };
}[ActionKind];

export interface FailedAction {
  action: QueuedAction;
  message: string;
}

/** The server or the connection may recover; try again later. */
export function isRetryable(error: unknown): boolean {
  if (isNetworkError(error)) return true;
  if (error instanceof ApiError) return error.status >= 500 || error.status === 408 || error.status === 429;
  // A session that expired mid-way: the driver must log in again before anything is sent
  return (error as { name?: string })?.name === 'SessionExpiredError';
}

type Listener = (items: readonly QueuedAction[]) => void;
type FailureListener = (failed: FailedAction) => void;

class ActionQueue {
  private items: QueuedAction[] = [];
  private listeners = new Set<Listener>();
  private failureListeners = new Set<FailureListener>();
  private flushing: Promise<{ sent: number; failed: FailedAction[] }> | null = null;
  private ready: Promise<void>;

  constructor() {
    this.ready = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) this.items = parsed as QueuedAction[];
        } catch {
          // A damaged queue is dropped rather than blocking the app
        }
      })
      .catch(() => {})
      .then(() => this.emit());
  }

  /** Waits until the saved queue has been read. */
  whenReady() {
    return this.ready;
  }

  getItems(): readonly QueuedAction[] {
    return this.items;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Called for every action the server refused for good and that was therefore dropped. */
  onFailure(listener: FailureListener): () => void {
    this.failureListeners.add(listener);
    return () => {
      this.failureListeners.delete(listener);
    };
  }

  private emit() {
    const snapshot = [...this.items];
    this.listeners.forEach((l) => l(snapshot));
  }

  private async save() {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
    } catch (e) {
      console.warn('[queue] could not save the queue:', e);
    }
    this.emit();
  }

  /**
   * Runs the action now if nothing is waiting ahead of it and there is a
   * connection; otherwise keeps it to send later. Resolves 'sent' (with the
   * server's answer) or 'queued'; rejects for an error the server gave (a
   * queued action would only fail again).
   */
  async submit<K extends ActionKind>(
    kind: K,
    payload: Payloads[K],
  ): Promise<{ status: 'sent'; result: any } | { status: 'queued' }> {
    await this.ready;
    const info = await api.getDriverInfo().catch(() => null);
    const action = { id: Crypto.randomUUID(), kind, payload, createdAt: Date.now(), attempts: 0, driverId: info?.id ?? null } as QueuedAction;

    // Earlier actions go first
    if (this.items.length > 0) await this.flush();
    if (this.items.length === 0) {
      try {
        return { status: 'sent', result: await this.execute(action) };
      } catch (e) {
        if (!isRetryable(e)) throw e;
      }
    }
    await this.enqueue(action);
    return { status: 'queued' };
  }

  private async enqueue(action: QueuedAction) {
    if (action.kind === 'complete_stop') await this.keepFiles(action);
    if (action.kind === 'upload_document') await this.keepDocumentFiles(action);
    this.items.push(action);
    await this.save();
  }

  /** Copies the proof photo and signature somewhere the system will not clear. */
  private async keepFiles(action: Extract<QueuedAction, { kind: 'complete_stop' }>) {
    const p = action.payload;
    try {
      await FileSystem.makeDirectoryAsync(FILES_DIR, { intermediates: true });
      const keep = async (uri: string | null | undefined, name: string) => {
        if (!uri || uri.startsWith(FILES_DIR)) return uri ?? null;
        const to = `${FILES_DIR}${action.id}_${name}`;
        await FileSystem.copyAsync({ from: uri, to });
        return to;
      };
      p.photoUri = await keep(p.photoUri, 'photo.jpg');
      p.signatureUri = await keep(p.signatureUri, 'signature.png');
    } catch (e) {
      console.warn('[queue] could not keep the proof files:', e);
    }
  }

  /** Copies the document pictures somewhere the system will not clear. */
  private async keepDocumentFiles(action: Extract<QueuedAction, { kind: 'upload_document' }>) {
    const p = action.payload;
    try {
      await FileSystem.makeDirectoryAsync(FILES_DIR, { intermediates: true });
      const kept: string[] = [];
      for (let i = 0; i < p.fileUris.length; i++) {
        const uri = p.fileUris[i];
        if (uri.startsWith(FILES_DIR)) {
          kept.push(uri);
          continue;
        }
        const to = `${FILES_DIR}${action.id}_doc${i}.jpg`;
        await FileSystem.copyAsync({ from: uri, to });
        kept.push(to);
      }
      p.fileUris = kept;
    } catch (e) {
      console.warn('[queue] could not keep the document files:', e);
    }
  }

  private async dropFiles(action: QueuedAction) {
    if (action.kind === 'upload_document') {
      for (const uri of action.payload.fileUris) {
        if (uri.startsWith(FILES_DIR)) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      }
      return;
    }
    if (action.kind !== 'complete_stop') return;
    for (const uri of [action.payload.photoUri, action.payload.signatureUri]) {
      if (uri && uri.startsWith(FILES_DIR)) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  }

  /** Sends one action to the server. Throws the error the API gave. */
  private async execute(action: QueuedAction): Promise<any> {
    const key = action.id;
    switch (action.kind) {
      case 'complete_stop': {
        const p = action.payload;
        const paths = await uploadProofFiles(p.stopId, p, p.uploaded, (uploaded) => {
          p.uploaded = uploaded;
          // Remember what was uploaded if this action is already saved
          if (this.items.some((i) => i.id === action.id)) this.save();
        });
        return api.completeStop(
          {
            stop_id: p.stopId,
            status: 'completed',
            received_by: p.receiverName,
            ...paths,
            ...(p.lat !== undefined && p.lng !== undefined ? { lat: p.lat, lng: p.lng } : {}),
          },
          key,
        );
      }
      case 'upload_document': {
        const p = action.payload;
        return sendDocument(p, key, (paths) => {
          p.uploadedPaths = paths;
          // Remember what was uploaded if this action is already saved
          if (this.items.some((i) => i.id === action.id)) this.save();
        });
      }
      case 'fail_stop': {
        const p = action.payload;
        return api.completeStop(
          {
            stop_id: p.stopId,
            status: 'failed',
            reason: p.reason,
            ...(p.note ? { note: p.note } : {}),
            ...(p.lat !== undefined && p.lng !== undefined ? { lat: p.lat, lng: p.lng } : {}),
          },
          key,
        );
      }
      case 'declare_load':
        return api.declareCapacity(action.payload.vehicleId, action.payload.percentage, key);
      case 'sos_details':
        return api.updateSosDetails(action.payload.alertId, action.payload.details, key);
      case 'scan': {
        const p = action.payload;
        return api.scanParcel(
          {
            code: p.code,
            purpose: p.purpose,
            ...(p.stopId ? { stop_id: p.stopId } : {}),
            method: p.method,
            ...(p.lat !== undefined && p.lng !== undefined ? { lat: p.lat, lng: p.lng } : {}),
          },
          key,
        );
      }
    }
  }

  /**
   * Sends everything waiting, oldest first. Stops at the first action that
   * cannot be sent yet, so order is kept. An action the server refuses for
   * good is removed and reported in `failed`.
   */
  flush(): Promise<{ sent: number; failed: FailedAction[] }> {
    if (this.flushing) return this.flushing;
    this.flushing = this.runFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async runFlush(): Promise<{ sent: number; failed: FailedAction[] }> {
    await this.ready;
    const failed: FailedAction[] = [];
    let sent = 0;
    const info = await api.getDriverInfo().catch(() => null);

    while (this.items.length > 0) {
      const action = this.items[0];
      // Somebody else's queue (another driver logged in on this phone) is not ours to send
      if (action.driverId && info?.id && action.driverId !== info.id) {
        this.items.shift();
        await this.dropFiles(action);
        await this.save();
        continue;
      }
      try {
        await this.execute(action);
        this.items.shift();
        sent += 1;
        await this.dropFiles(action);
        await this.save();
      } catch (e) {
        if (isRetryable(e)) {
          action.attempts += 1;
          await this.save();
          break;
        }
        this.items.shift();
        const failure = { action, message: (e as { message?: string })?.message ?? '' };
        failed.push(failure);
        this.failureListeners.forEach((l) => l(failure));
        await this.dropFiles(action);
        await this.save();
      }
    }
    return { sent, failed };
  }
}

export const actionQueue = new ActionQueue();
