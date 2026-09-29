/**
 * The driver's own documents. Each picture is shrunk to a JPEG on the phone
 * (this also turns iPhone HEIC photos into JPEG, which the server accepts) and
 * is then uploaded with a signed URL the backend issues for the driver's own
 * folder. Once every file is up, the document is recorded (status pending).
 *
 * The whole two-step upload runs as one offline-queue action
 * (`upload_document`, see actionQueue.ts), so with no signal it waits on the
 * phone and is sent later. Files already uploaded are remembered, so a retry
 * does not upload them again.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { api, ApiError, NetworkError, type DocType, type PersonDocument } from './api';

const MAX_WIDTH = 1600;
const QUALITY = 0.7;
/** The main file plus up to 4 more pages. */
export const MAX_DOCUMENT_FILES = 5;

export interface DocumentDetails {
  doc_number?: string;
  issued_on?: string;
  expires_on?: string;
  metadata?: Record<string, any>;
}

/** Shrinks a photo of a document to a JPEG small enough for a weak signal. Always writes JPEG, whatever the source format (HEIC included). */
export async function compressDocument(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: MAX_WIDTH } }], {
    compress: QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return result.uri;
}

/** Uploads one local JPEG and returns its storage path. */
async function uploadFile(docType: DocType, uri: string): Promise<string> {
  const contentType = 'image/jpeg';
  const target = await api.getMyDocumentUploadUrl({
    doc_type: docType,
    file_name: `${docType}.jpg`,
    content_type: contentType,
  });
  let response: Response;
  try {
    const blob = await (await fetch(uri)).blob();
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
  return target.path;
}

export interface DocumentUpload {
  docType: DocType;
  /** Local JPEGs: the main page first, then the back page and others. */
  fileUris: string[];
  details: DocumentDetails;
  /** Storage paths of the files already uploaded, in the same order as `fileUris`. */
  uploadedPaths?: string[];
}

/**
 * Uploads the files not yet uploaded, then records the document. `onProgress`
 * gets the paths after each file. Throws on failure, so the caller can retry.
 */
export async function sendDocument(
  upload: DocumentUpload,
  idempotencyKey?: string,
  onProgress?: (paths: string[]) => void,
): Promise<PersonDocument> {
  const paths = [...(upload.uploadedPaths ?? [])];
  for (let i = paths.length; i < upload.fileUris.length; i++) {
    paths.push(await uploadFile(upload.docType, upload.fileUris[i]));
    onProgress?.([...paths]);
  }
  const [main, ...extra] = paths;
  return api.createMyDocument(
    {
      doc_type: upload.docType,
      ...upload.details,
      file_path: main,
      ...(extra.length ? { extra_file_paths: extra } : {}),
    },
    idempotencyKey,
  );
}
