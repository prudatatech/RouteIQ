/**
 * margixindia — Proof of delivery files
 *
 * The driver's phone uploads the delivery photo and the receiver's signature
 * straight to the private storage bucket with a signed upload URL the backend
 * issues for one path. Only that path can then be stored on the stop, and staff
 * see the files through short-lived signed URLs.
 */
import crypto from 'crypto';
import { supabase } from '../core/supabase';
import { settings } from '../core/config';
import { HttpError } from '../core/errors';

export const POD_KINDS = ['photo', 'signature'] as const;
export type PodKind = (typeof POD_KINDS)[number];

const POD_CONTENT_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };
const SIGNED_URL_SECONDS = 600;

/** Folder of one stop's proof files. */
export const podFolder = (stopId: string) => `pod/${stopId}/`;

/** A stored path is accepted only inside the stop's own folder. */
export function isPodPathFor(path: unknown, stopId: string): path is string {
  return (
    typeof path === 'string' &&
    path.length <= 300 &&
    path.startsWith(podFolder(stopId)) &&
    !path.includes('..') &&
    !path.slice(podFolder(stopId).length).includes('/')
  );
}

export async function createPodUploadUrl(stopId: string, input: { kind: unknown; content_type: unknown; size: unknown }) {
  const kind = input.kind as PodKind;
  if (!POD_KINDS.includes(kind)) throw new HttpError(400, 'kind must be photo or signature');
  const extension = typeof input.content_type === 'string' ? POD_CONTENT_TYPES[input.content_type.toLowerCase()] : undefined;
  if (!extension) throw new HttpError(415, 'Upload a JPG or PNG image');
  const bytes = Number(input.size);
  if (!Number.isInteger(bytes) || bytes <= 0) throw new HttpError(400, 'File size is required');
  if (bytes > settings.POD_UPLOAD_MAX_BYTES) {
    throw new HttpError(413, `Image must be at most ${Math.floor(settings.POD_UPLOAD_MAX_BYTES / 1024 / 1024)} MB`);
  }
  const path = `${podFolder(stopId)}${kind}_${crypto.randomUUID()}.${extension}`;
  const { data, error } = await supabase.storage.from(settings.KYC_DOCUMENTS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`Failed to create upload URL: ${error?.message}`);
  return { path: data.path, token: data.token, signed_url: data.signedUrl, bucket: settings.KYC_DOCUMENTS_BUCKET };
}

async function signedUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(settings.KYC_DOCUMENTS_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
}

export interface ProofOfDelivery {
  received_by: string | null;
  photo_url: string | null;
  signature_url: string | null;
  /** A signature captured before file uploads existed (a data URL). */
  signature_data: string | null;
}

/** The proof stored for a shipment or vendor load, with signed links to its files. */
export async function getProofOfDelivery(id: string): Promise<ProofOfDelivery | null> {
  const { data: shipment } = await supabase
    .from('shipments')
    .select('received_by, photo_url, signature_url, signature_data')
    .eq('id', id)
    .maybeSingle();
  const row = shipment ?? (await supabase.from('cargo_manifest').select('received_by, photo_url, signature_url').eq('id', id).maybeSingle()).data;
  if (!row) return null;
  const [photo, signature] = await Promise.all([signedUrl(row.photo_url as string | null), signedUrl(row.signature_url as string | null)]);
  return {
    received_by: (row.received_by as string | null) ?? null,
    photo_url: photo,
    signature_url: signature,
    signature_data: ((row as { signature_data?: string | null }).signature_data as string | null) ?? null,
  };
}
