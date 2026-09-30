/**
 * Claim photos go straight to the private storage bucket with a signed upload
 * URL the backend issues for one path (the same pattern as the driver app's
 * proof-of-delivery upload), so the photo never passes through our API.
 */
import { api } from './api';
import { translateNow } from '../locales';

/** A photo the customer picked, still on the phone. */
export interface ClaimPhoto {
  uri: string;
  mimeType: string;
  fileName: string;
}

/** Uploads one photo to the claim and returns its storage path. Throws on failure, so the caller can retry it. */
export async function uploadClaimPhoto(claimId: string, photo: ClaimPhoto): Promise<string> {
  const blob = await (await fetch(photo.uri)).blob();
  const target = await api.getClaimUploadUrl(claimId, {
    content_type: photo.mimeType,
    size: blob.size,
    file_name: photo.fileName,
  });
  let response: Response;
  try {
    response = await fetch(target.signed_url, {
      method: 'PUT',
      headers: { 'Content-Type': photo.mimeType, 'x-upsert': 'false' },
      body: blob,
    });
  } catch {
    throw new Error(translateNow('err_network'));
  }
  if (!response.ok) throw new Error(translateNow('err_server'));
  return target.path;
}
