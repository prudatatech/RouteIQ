/**
 * The optional bill photo of a fill-up. The picture is shrunk to a JPEG on the phone (this also
 * turns iPhone HEIC photos into JPEG) and uploaded with a signed URL the backend issues.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { api, ApiError, NetworkError } from './api';

const MAX_WIDTH = 1600;
const QUALITY = 0.7;

export async function compressBill(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: MAX_WIDTH } }], {
    compress: QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return result.uri;
}

/** Uploads one local JPEG and returns its storage path. */
export async function uploadBill(vehicleId: string, uri: string): Promise<string> {
  const contentType = 'image/jpeg';
  let blob: Blob;
  try {
    blob = await (await fetch(uri)).blob();
  } catch {
    throw new NetworkError();
  }
  const target = await api.getFuelBillUploadUrl(vehicleId, { content_type: contentType, size: blob.size });
  let response: Response;
  try {
    response = await fetch(target.signed_url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, 'x-upsert': 'false' },
      body: blob,
    });
  } catch {
    throw new NetworkError();
  }
  if (!response.ok) throw new ApiError(`The bill could not be uploaded (${response.status})`, response.status);
  return target.path;
}
