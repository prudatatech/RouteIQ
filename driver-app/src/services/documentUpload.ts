/**
 * The driver's own documents: the picture is shrunk to a JPEG, uploaded with a
 * signed URL the backend issues for the driver's own folder, and then recorded
 * as the current document of that type (status pending until staff verify it).
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { api, ApiError, NetworkError, type DocType, type PersonDocument } from './api';

const MAX_WIDTH = 1600;
const QUALITY = 0.7;

export interface DocumentDetails {
  doc_number?: string;
  issued_on?: string;
  expires_on?: string;
  metadata?: Record<string, any>;
}

/** Shrinks a photo of a document to a JPEG small enough for a weak signal. */
export async function compressDocument(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: MAX_WIDTH } }], {
    compress: QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return result.uri;
}

/** Uploads a local image as the driver's document of `docType`. Throws on failure, so the caller can retry. */
export async function uploadMyDocument(docType: DocType, uri: string, details: DocumentDetails): Promise<PersonDocument> {
  const small = await compressDocument(uri);
  const contentType = 'image/jpeg';
  const target = await api.getMyDocumentUploadUrl({
    doc_type: docType,
    file_name: `${docType}.jpg`,
    content_type: contentType,
  });

  let response: Response;
  try {
    const blob = await (await fetch(small)).blob();
    response = await fetch(target.signed_url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, 'x-upsert': 'false' },
      body: blob,
    });
  } catch {
    throw new NetworkError();
  }
  if (!response.ok) {
    throw new ApiError(`The document could not be uploaded (${response.status})`, response.status);
  }

  return api.createMyDocument({ doc_type: docType, ...details, file_path: target.path });
}
