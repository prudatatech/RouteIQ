/**
 * Proof-of-delivery files: the delivery photo (compressed) and the receiver's
 * signature. Each is uploaded straight to the private storage bucket with a
 * signed upload URL the backend issues for one path; the stop is then completed
 * with that path.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { api, ApiError } from './api';

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

/** Uploads whichever files are set, skipping the ones already uploaded. */
export async function uploadProofFiles(stopId: string, pod: PodInput, done: PodPaths = {}): Promise<PodPaths> {
  const paths: PodPaths = { ...done };
  if (pod.photoUri && !paths.photo_url) paths.photo_url = await uploadProofFile(stopId, 'photo', pod.photoUri);
  if (pod.signatureUri && !paths.signature_url) paths.signature_url = await uploadProofFile(stopId, 'signature', pod.signatureUri);
  return paths;
}
