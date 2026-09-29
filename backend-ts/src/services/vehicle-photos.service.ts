/**
 * margixindia — Vehicle photos
 *
 * Front, side, back and, optionally, interior and cargo area. Every photo is
 * optional and can be added or replaced at any time, by staff or by the
 * vehicle's own driver. One photo per vehicle and slot.
 *
 * Files go to the private kyc_documents bucket under vehicles/<vehicle id>/photos/
 * with a signed upload URL the backend issues for one path (same pattern as
 * proof of delivery); only a path inside the vehicle's own folder can then be
 * stored, and clients see the files through short-lived signed links.
 */
import crypto from 'crypto';
import { supabase } from '../core/supabase';
import { settings } from '../core/config';
import { HttpError } from '../core/errors';
import { createKycUploadUrl, signedUrl } from './pod.service';
import { removeStoredFiles } from './people-common';

export const VEHICLE_PHOTO_SLOTS = ['front', 'side', 'back', 'interior', 'cargo'] as const;
export type VehiclePhotoSlot = (typeof VEHICLE_PHOTO_SLOTS)[number];

const PHOTO_CONTENT_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };

export const vehiclePhotoFolder = (vehicleId: string) => `vehicles/${vehicleId}/photos/`;

export interface VehiclePhoto {
  slot: VehiclePhotoSlot;
  /** A 10-minute signed link, or null when it could not be signed. */
  url: string | null;
  updated_at: string | null;
}

export function parsePhotoSlot(value: unknown): VehiclePhotoSlot {
  if (!(VEHICLE_PHOTO_SLOTS as readonly string[]).includes(String(value))) {
    throw new HttpError(400, `slot must be one of: ${VEHICLE_PHOTO_SLOTS.join(', ')}`);
  }
  return value as VehiclePhotoSlot;
}

/** A stored path is accepted only inside the vehicle's own photo folder, as one file name. */
export function isVehiclePhotoPathFor(path: unknown, vehicleId: string): path is string {
  if (typeof path !== 'string' || path.length > 300 || path.includes('..') || path.includes('\\')) return false;
  const folder = vehiclePhotoFolder(vehicleId);
  return path.startsWith(folder) && /^[A-Za-z0-9_.-]+$/.test(path.slice(folder.length));
}

async function assertVehicleExists(vehicleId: string): Promise<void> {
  const { data, error } = await supabase.from('vehicles').select('id').eq('id', vehicleId).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Vehicle not found');
}

export async function createVehiclePhotoUploadUrl(vehicleId: string, input: { slot: unknown; content_type: unknown; size: unknown }) {
  const slot = parsePhotoSlot(input.slot);
  const extension = typeof input.content_type === 'string' ? PHOTO_CONTENT_TYPES[input.content_type.toLowerCase()] : undefined;
  if (!extension) throw new HttpError(415, 'Upload a JPG or PNG image');
  const bytes = Number(input.size);
  if (!Number.isInteger(bytes) || bytes <= 0) throw new HttpError(400, 'File size is required');
  if (bytes > settings.VEHICLE_PHOTO_MAX_BYTES) {
    throw new HttpError(413, `Image must be at most ${Math.floor(settings.VEHICLE_PHOTO_MAX_BYTES / 1024 / 1024)} MB`);
  }
  await assertVehicleExists(vehicleId);
  return createKycUploadUrl(`${vehiclePhotoFolder(vehicleId)}${slot}_${crypto.randomUUID()}.${extension}`);
}

/** Records an uploaded file as the vehicle's photo for `slot`, replacing (and deleting) the previous one. */
export async function saveVehiclePhoto(vehicleId: string, slotValue: unknown, filePath: unknown, userId: string) {
  const slot = parsePhotoSlot(slotValue);
  if (!isVehiclePhotoPathFor(filePath, vehicleId)) throw new HttpError(400, 'file_path is not an upload for this vehicle');
  if (!filePath.split('/').pop()!.startsWith(`${slot}_`)) throw new HttpError(400, 'file_path was uploaded for a different photo');
  await assertVehicleExists(vehicleId);

  const { data: previous, error: pErr } = await supabase
    .from('vehicle_photos').select('file_path').eq('vehicle_id', vehicleId).eq('slot', slot).maybeSingle();
  if (pErr) throw pErr;

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('vehicle_photos')
    .upsert(
      { vehicle_id: vehicleId, slot, file_path: filePath, uploaded_by: userId, updated_at: now },
      { onConflict: 'vehicle_id,slot' },
    )
    .select('slot, file_path, updated_at')
    .single();
  if (error || !data) throw new Error(`Failed to save vehicle photo: ${error?.message}`);

  if (previous?.file_path && previous.file_path !== filePath) await removeStoredFiles([previous.file_path as string]);
  return { slot, url: await signedUrl(filePath), updated_at: (data.updated_at as string | null) ?? now };
}

export async function deleteVehiclePhoto(vehicleId: string, slotValue: unknown): Promise<void> {
  const slot = parsePhotoSlot(slotValue);
  const { data, error } = await supabase
    .from('vehicle_photos').delete().eq('vehicle_id', vehicleId).eq('slot', slot).select('file_path').maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'This vehicle has no photo in that slot');
  await removeStoredFiles([data.file_path as string]);
}

const slotOrder = (slot: string) => (VEHICLE_PHOTO_SLOTS as readonly string[]).indexOf(slot);

/** The photos of several vehicles, in slot order, with signed links. */
export async function listPhotosFor(vehicleIds: string[]): Promise<Map<string, VehiclePhoto[]>> {
  const result = new Map<string, VehiclePhoto[]>(vehicleIds.map(id => [id, []]));
  if (vehicleIds.length === 0) return result;
  const { data, error } = await supabase
    .from('vehicle_photos').select('vehicle_id, slot, file_path, updated_at').in('vehicle_id', vehicleIds);
  if (error) throw error;
  const rows = [...(data ?? [])].sort((a, b) => slotOrder(String(a.slot)) - slotOrder(String(b.slot)));
  const urls = await Promise.all(rows.map(r => signedUrl(r.file_path as string)));
  rows.forEach((row, i) => {
    result.get(row.vehicle_id as string)?.push({ slot: row.slot as VehiclePhotoSlot, url: urls[i], updated_at: (row.updated_at as string | null) ?? null });
  });
  return result;
}

export async function listVehiclePhotos(vehicleId: string): Promise<VehiclePhoto[]> {
  return (await listPhotosFor([vehicleId])).get(vehicleId) ?? [];
}

/** The photo to show as a vehicle's thumbnail: the first one in slot order (front first). */
export function primaryPhoto(photos: VehiclePhoto[]): VehiclePhoto | null {
  return photos.find(p => p.url) ?? null;
}

/** Deletes every photo file of a vehicle that is being removed (the rows go with the vehicle). */
export async function removeVehiclePhotoFiles(vehicleId: string): Promise<void> {
  const { data } = await supabase.from('vehicle_photos').select('file_path').eq('vehicle_id', vehicleId);
  await removeStoredFiles((data ?? []).map(r => r.file_path as string));
}
