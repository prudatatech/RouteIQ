/**
 * Proof-of-delivery files: the delivery photo (compressed) and the receiver's
 * signature. Each is uploaded straight to the private storage bucket with a
 * signed upload URL the backend issues for one path; the stop is then completed
 * with that path.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { api, ApiError } from './api';
import type { ConsignmentRef } from './cargo';

export type PodKind = 'photo' | 'signature';

/** What the driver entered at the stop. Files are local URIs until they are uploaded. */
export interface PodInput {
  receiverName: string;
  photoUri?: string | null;
  signatureUri?: string | null;
}

/** Storage paths of files already uploaded. */
export interface PodPaths {
  photo_url?: string;
  signature_url?: string;
}

const PHOTO_MAX_WIDTH = 1280;
const PHOTO_QUALITY = 0.6;

/** Shrinks a camera photo to a JPEG of about 200 to 400 KB. */
export async function compressPhoto(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: PHOTO_MAX_WIDTH } }], {
    compress: PHOTO_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return result.uri;
}

/** Uploads one local image and returns its storage path. Throws on failure, so the caller can retry. */
export async function uploadProofFile(stopId: string, kind: PodKind, uri: string): Promise<string> {
  const contentType = kind === 'photo' ? 'image/jpeg' : 'image/png';
  const blob = await (await fetch(uri)).blob();
  const target = await api.getPodUploadUrl({ stop_id: stopId, kind, content_type: contentType, size: blob.size });

  const response = await fetch(target.signed_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, 'x-upsert': 'false' },
    body: blob,
  });
  if (!response.ok) {
    throw new ApiError(`The ${kind} could not be uploaded (${response.status})`, response.status);
  }
  return target.path;
}

/** Uploads whichever files are set, skipping the ones already uploaded. `onProgress` gets the paths after each upload. */
export async function uploadProofFiles(
  stopId: string,
  pod: Pick<PodInput, 'photoUri' | 'signatureUri'>,
  done: PodPaths = {},
  onProgress?: (paths: PodPaths) => void,
): Promise<PodPaths> {
  const paths: PodPaths = { ...done };
  if (pod.photoUri && !paths.photo_url) {
    paths.photo_url = await uploadProofFile(stopId, 'photo', pod.photoUri);
    onProgress?.({ ...paths });
  }
  if (pod.signatureUri && !paths.signature_url) {
    paths.signature_url = await uploadProofFile(stopId, 'signature', pod.signatureUri);
    onProgress?.({ ...paths });
  }
  return paths;
}

/** Storage paths of custody files already uploaded; `photos[i]` belongs to the i-th photo. */
export interface CargoFilePaths {
  photos: string[];
  signature?: string;
}

/** Whose folder a custody file goes into: a consignment's, or a transfer's (for handovers). */
export type CargoFileOwner = { ref: ConsignmentRef } | { transfer_id: string };

/** Uploads one custody image with POST /cargo/custody/upload-url and returns its storage path. */
async function uploadCargoFile(owner: CargoFileOwner, kind: PodKind, uri: string): Promise<string> {
  const contentType = kind === 'photo' ? 'image/jpeg' : 'image/png';
  const blob = await (await fetch(uri)).blob();
  const target = await api.getCustodyUploadUrl(owner, { kind, content_type: contentType, size: blob.size });
  const response = await fetch(target.signed_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, 'x-upsert': 'false' },
    body: blob,
  });
  if (!response.ok) throw new ApiError(`The ${kind} could not be uploaded (${response.status})`, response.status);
  return target.path;
}

/**
 * Photos and a signature for a custody event (pickup, cargo check, hub drop, return pickup) or a
 * transfer handover, into the owner's own folder: the server accepts only files from there.
 * Already uploaded files are skipped, so a retry never uploads twice.
 */
export async function uploadCargoFiles(
  owner: CargoFileOwner,
  files: { photoUris: string[]; signatureUri?: string | null },
  done: CargoFilePaths = { photos: [] },
  onProgress?: (paths: CargoFilePaths) => void,
): Promise<CargoFilePaths> {
  const paths: CargoFilePaths = { photos: [...done.photos], signature: done.signature };
  for (let i = 0; i < files.photoUris.length; i++) {
    if (paths.photos[i]) continue;
    paths.photos[i] = await uploadCargoFile(owner, 'photo', files.photoUris[i]);
    onProgress?.({ photos: [...paths.photos], signature: paths.signature });
  }
  if (files.signatureUri && !paths.signature) {
    paths.signature = await uploadCargoFile(owner, 'signature', files.signatureUri);
    onProgress?.({ photos: [...paths.photos], signature: paths.signature });
  }
  return paths;
}
