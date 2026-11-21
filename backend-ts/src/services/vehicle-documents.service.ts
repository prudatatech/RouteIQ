/**
 * margixindia — Vehicle documents (RC, insurance, fitness, permit, PUC)
 *
 * Unlike driver identity documents (one row per document in user_documents), a vehicle carries exactly
 * one of each of these five, already as columns on vehicles (rc_document_url, insurance_document_url, ...),
 * set when the owner (admin console) created the row directly. A vehicle a driver registers from the app
 * never had a way to attach the files themselves - only the document numbers and expiry dates - so staff
 * reviewing a request often had nothing to actually look at. This gives the driver (and staff) a real
 * upload for each, the same signed-URL pattern as vehicle photos: files go to the private kyc_documents
 * bucket under vehicles/<vehicle id>/documents/, and only a path inside the vehicle's own folder, for the
 * slot it was requested for, can be recorded.
 *
 * Uploading a corrected file clears any staff-flagged issue for that one slot (vehicle-approval.service.ts
 * document_issues), the same way a full resubmission already clears a whole rejection.
 */
import crypto from 'crypto';
import { supabase } from '../core/supabase';
import { settings } from '../core/config';
import { HttpError } from '../core/errors';
import { createKycUploadUrl, signedUrl } from './pod.service';
import { removeStoredFiles } from './people-common';

export const VEHICLE_DOCUMENT_SLOTS = ['rc', 'insurance', 'fitness', 'permit', 'puc'] as const;
export type VehicleDocumentSlot = (typeof VEHICLE_DOCUMENT_SLOTS)[number];

export const VEHICLE_DOCUMENT_LABELS: Record<VehicleDocumentSlot, string> = {
  rc: 'Registration certificate (RC)',
  insurance: 'Insurance',
  fitness: 'Fitness certificate',
  permit: 'Permit',
  puc: 'Pollution certificate (PUC)',
};

const DOCUMENT_FILE_COLUMN: Record<VehicleDocumentSlot, string> = {
  rc: 'rc_document_url',
  insurance: 'insurance_document_url',
  fitness: 'fitness_document_url',
  permit: 'permit_document_url',
  puc: 'puc_document_url',
};

const DOC_CONTENT_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export const vehicleDocumentFolder = (vehicleId: string) => `vehicles/${vehicleId}/documents/`;

export function parseDocumentSlot(value: unknown): VehicleDocumentSlot {
  if (!(VEHICLE_DOCUMENT_SLOTS as readonly string[]).includes(String(value))) {
    throw new HttpError(400, `slot must be one of: ${VEHICLE_DOCUMENT_SLOTS.join(', ')}`);
  }
  return value as VehicleDocumentSlot;
}

/** A stored path is accepted only inside the vehicle's own document folder, as one file name. */
export function isVehicleDocumentPathFor(path: unknown, vehicleId: string): path is string {
  if (typeof path !== 'string' || path.length > 300 || path.includes('..') || path.includes('\\')) return false;
  const folder = vehicleDocumentFolder(vehicleId);
  return path.startsWith(folder) && /^[A-Za-z0-9_.-]+$/.test(path.slice(folder.length));
}

async function loadVehicle(vehicleId: string): Promise<Record<string, any>> {
  const { data, error } = await supabase.from('vehicles').select('*').eq('id', vehicleId).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Vehicle not found');
  return data;
}

export async function createVehicleDocumentUploadUrl(vehicleId: string, input: { slot: unknown; content_type: unknown; size: unknown }) {
  const slot = parseDocumentSlot(input.slot);
  const extension = typeof input.content_type === 'string' ? DOC_CONTENT_TYPES[input.content_type.toLowerCase()] : undefined;
  if (!extension) throw new HttpError(415, 'Upload a PDF, JPG or PNG file');
  const bytes = Number(input.size);
  if (!Number.isInteger(bytes) || bytes <= 0) throw new HttpError(400, 'File size is required');
  if (bytes > settings.VEHICLE_DOCUMENT_MAX_BYTES) {
    throw new HttpError(413, `File must be at most ${Math.floor(settings.VEHICLE_DOCUMENT_MAX_BYTES / 1024 / 1024)} MB`);
  }
  await loadVehicle(vehicleId);
  return createKycUploadUrl(`${vehicleDocumentFolder(vehicleId)}${slot}_${crypto.randomUUID()}.${extension}`);
}

/**
 * Records an uploaded file as the vehicle's document for `slot`, replacing the previous one and
 * clearing any staff-flagged issue for that slot - a corrected file is the driver's answer to it.
 */
export async function saveVehicleDocument(vehicleId: string, slotValue: unknown, filePath: unknown) {
  const slot = parseDocumentSlot(slotValue);
  if (!isVehicleDocumentPathFor(filePath, vehicleId)) throw new HttpError(400, 'file_path is not an upload for this vehicle');
  if (!filePath.split('/').pop()!.startsWith(`${slot}_`)) throw new HttpError(400, 'file_path was uploaded for a different document');
  const vehicle = await loadVehicle(vehicleId);
  const column = DOCUMENT_FILE_COLUMN[slot];
  const previous = vehicle[column] as string | null;

  const issues = { ...(vehicle.document_issues ?? {}) };
  const hadIssue = slot in issues;
  if (hadIssue) delete issues[slot];

  const { data, error } = await supabase
    .from('vehicles')
    .update({ [column]: filePath, document_issues: Object.keys(issues).length > 0 ? issues : null })
    .eq('id', vehicleId)
    .select(`id, ${column}, document_issues`)
    .single();
  if (error || !data) throw new Error(`Failed to save vehicle document: ${error?.message}`);

  // Storage paths are signed; a staff-pasted plain URL (the old, upload-less path) is not ours to delete
  if (previous && previous !== filePath && !/^https?:\/\//.test(previous)) await removeStoredFiles([previous]);
  return { slot, url: await signedUrl(filePath), issue_cleared: hadIssue };
}

/**
 * A vehicle's five document columns, each resolved to a short-lived signed link when it is one of our
 * own storage paths (uploaded through this service); a staff-pasted plain URL (the old, upload-less way
 * of recording these) is returned exactly as stored, since there is nothing of ours to sign.
 */
export async function withSignedDocumentUrls<T extends Record<string, any>>(vehicle: T): Promise<T> {
  const out: Record<string, any> = { ...vehicle };
  await Promise.all(VEHICLE_DOCUMENT_SLOTS.map(async slot => {
    const column = DOCUMENT_FILE_COLUMN[slot];
    const value = vehicle[column] as string | null | undefined;
    if (value && !/^https?:\/\//.test(value)) out[column] = await signedUrl(value);
  }));
  return out as T;
}
