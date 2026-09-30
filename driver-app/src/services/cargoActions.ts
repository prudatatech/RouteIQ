/**
 * Sending cargo records from the screens. Everything goes through the offline
 * queue, so with no signal it waits on the phone (photos included) and is
 * sent later with the same idempotency keys.
 */
import { actionQueue, type CustodyPayload, type TransferPayload } from './actionQueue';
import { api } from './api';
import { readConsignmentInfo, type ConsignmentRef, type ExceptionNotice } from './cargo';

export interface CargoSendResult {
  /** No signal: kept on the phone. */
  queued: boolean;
  /** Cases open on these goods (EXC-…), looked up after the send. */
  exceptions: ExceptionNotice[];
}

/** The `:ref` of GET /cargo/where: a shipment or load id, or the tracking ID / load code. */
const refPath = (ref: ConsignmentRef) => (typeof ref === 'string' ? ref : 'shipment_id' in ref ? ref.shipment_id : ref.manifest_id);

/**
 * The open cases on these consignments, with their codes. A custody answer names the cases it
 * opened only by id, so the codes come from `where`. With `ids`, only those cases; otherwise all
 * open ones. Best effort: a failure here never hides that the record was saved.
 */
export async function openCaseCodes(refs: ConsignmentRef[], ids?: string[]): Promise<ExceptionNotice[]> {
  const seen = new Set<string>();
  const out: ExceptionNotice[] = [];
  for (const ref of refs) {
    const key = refPath(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      for (const e of readConsignmentInfo(await api.getCargoWhere(key)).exceptions) {
        if ((!ids || (e.id && ids.includes(e.id))) && !out.some((o) => o.code === e.code)) out.push(e);
      }
    } catch {
      // The codes are a courtesy; dispatch has the case either way
    }
  }
  return out;
}

export async function sendCustody(payload: CustodyPayload): Promise<CargoSendResult> {
  const outcome = await actionQueue.submit('custody', payload);
  if (outcome.status === 'queued') return { queued: true, exceptions: [] };
  const ids: string[] = outcome.result?.exceptionIds ?? [];
  const exceptions = ids.length ? await openCaseCodes(payload.events.map((e) => e.ref), ids) : [];
  return { queued: false, exceptions };
}

/** A handover; when a count came up short, the open cases on those goods are looked up for the driver. */
export async function sendHandover(payload: TransferPayload, short: boolean): Promise<CargoSendResult> {
  const outcome = await actionQueue.submit('transfer', payload);
  if (outcome.status === 'queued') return { queued: true, exceptions: [] };
  const exceptions = short ? await openCaseCodes(payload.items.map((i) => i.ref)) : [];
  return { queued: false, exceptions };
}
