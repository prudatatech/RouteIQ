/**
 * Request bodies for the vendor company profile, KYC submission and KYC
 * documents. Messages are written for the person who sent the form.
 */
import { z } from 'zod';
import { HttpError } from '../core/errors';
import { samePlace, validPlace } from '../core/places';

const GST_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i;
const PAN_PATTERN = /^[A-Z]{5}\d{4}[A-Z]$/i;

/** Read a value that may only be blank, the "PENDING" placeholder, or a real GST number. */
const gstNumber = z
  .string()
  .trim()
  .max(15, 'GST number must be 15 characters')
  .refine(v => v === '' || v === 'PENDING' || GST_PATTERN.test(v), 'GST number looks incorrect');

const coordinate = (label: string, limit: number) =>
  z.number({ invalid_type_error: `${label} must be a number`, required_error: `${label} is required` }).min(-limit, `${label} is out of range`).max(limit, `${label} is out of range`);

export const VendorProfileSchema = z.object({
  companyName: z.string().trim().min(2, 'Enter your company name').max(200, 'Company name is too long'),
  gstNumber: gstNumber.optional().default(''),
  city: z.string().trim().min(1, 'Enter the city').max(100, 'City name is too long'),
  address: z.string().trim().min(1, 'Enter the address').max(500, 'Address is too long'),
  lat: coordinate('Latitude', 90),
  lng: coordinate('Longitude', 180),
});
export type VendorProfileInput = z.infer<typeof VendorProfileSchema>;

/** Where staff place a vendor's pickup when the vendor has not (address and company details stay the vendor's own). */
export const VendorLocationSchema = z.object({
  lat: coordinate('Latitude', 90),
  lng: coordinate('Longitude', 180),
  city: z.string().trim().min(1, 'Enter the city').max(100, 'City name is too long').optional(),
}).refine(v => !(v.lat === 0 && v.lng === 0), 'Choose a real location');

/** Storage paths of KYC files: <vendor id>/<file>, no folder tricks. */
export function isOwnKycPath(vendorId: string, path: unknown): path is string {
  return typeof path === 'string'
    && path.length <= 300
    && path.startsWith(`${vendorId}/`)
    && !path.includes('..')
    && !path.slice(vendorId.length + 1).includes('/');
}

const KYC_DOC_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
export const MAX_OTHER_KYC_DOCS = 10;
const MAX_KYC_DATA_BYTES = 100 * 1024;

const OtherDocSchema = z.object({
  name: z.string().trim().min(1).max(200),
  path: z.string().min(1).max(300),
});

export const KycSubmitSchema = VendorProfileSchema.extend({
  companyLogo: z.string().max(300).nullable().optional(),
  kycData: z.object({
    data: z.record(z.string(), z.unknown()).optional(),
    otherDocs: z.array(OtherDocSchema).max(MAX_OTHER_KYC_DOCS, `Attach at most ${MAX_OTHER_KYC_DOCS} other documents`).optional(),
  }).passthrough(),
});
export type KycSubmitInput = z.infer<typeof KycSubmitSchema>;

export const KycDocumentsSchema = z.object({
  docUrls: z.record(z.string(), z.string().min(1).max(300)).optional(),
  otherDocs: z.array(OtherDocSchema).max(MAX_OTHER_KYC_DOCS, `Attach at most ${MAX_OTHER_KYC_DOCS} other documents`).optional(),
}).refine(v => v.docUrls !== undefined || v.otherDocs !== undefined, 'Nothing to save');

/**
 * Checks the parts of a KYC submission zod cannot express: the size of the
 * form blob, the company PAN, and that every document path lives in the
 * vendor's own folder. Throws a 400 HttpError.
 */
export function assertKycContent(vendorId: string, input: KycSubmitInput): void {
  if (Buffer.byteLength(JSON.stringify(input.kycData), 'utf8') > MAX_KYC_DATA_BYTES) {
    throw new HttpError(400, 'The KYC form is too large. Remove some details and try again.');
  }
  const form = (input.kycData.data ?? {}) as Record<string, unknown>;
  if (typeof form.panNumber === 'string' && form.panNumber.trim() && !PAN_PATTERN.test(form.panNumber.trim())) {
    throw new HttpError(400, 'PAN looks incorrect (for example AAAAA0000A)');
  }
  assertOwnDocumentPaths(vendorId, form.docUrls, input.kycData.otherDocs);
  if (input.companyLogo && !isOwnKycPath(vendorId, input.companyLogo)) {
    throw new HttpError(400, 'The company logo must be a file you uploaded here');
  }
}

/** Throws a 400 unless every path in `docUrls` (key -> path) and `otherDocs` is one of the vendor's own uploads. */
export function assertOwnDocumentPaths(vendorId: string, docUrls: unknown, otherDocs: { path: string }[] | undefined): void {
  if (docUrls !== undefined && docUrls !== null) {
    if (typeof docUrls !== 'object' || Array.isArray(docUrls)) throw new HttpError(400, 'Document list is not valid');
    for (const [key, path] of Object.entries(docUrls as Record<string, unknown>)) {
      if (!KYC_DOC_KEY.test(key)) throw new HttpError(400, 'Document list is not valid');
      if (!isOwnKycPath(vendorId, path)) throw new HttpError(400, 'Documents must be files you uploaded here');
    }
  }
  for (const doc of otherDocs ?? []) {
    if (!isOwnKycPath(vendorId, doc.path)) throw new HttpError(400, 'Documents must be files you uploaded here');
  }
}

// ── Reviewing a vendor (platform) ──────────────────────────

export const RequestInfoSchema = z.object({
  message: z.string().trim().max(1000, 'The message is too long (at most 1000 characters)').optional(),
  items: z.array(z.object({
    label: z.string().trim().min(1, 'Name each item you ask for').max(120, 'An item name is too long (at most 120 characters)'),
    kind: z.enum(['text', 'document'], { errorMap: () => ({ message: 'Each item is either text or a document' }) }),
    hint: z.string().trim().max(300, 'A hint is too long (at most 300 characters)').optional(),
  })).min(1, 'Ask for at least one item').max(10, 'Ask for at most 10 items'),
});

export const KycRespondSchema = z.object({
  request_id: z.string().uuid('Request not found'),
  answers: z.array(z.object({
    key: z.string().min(1).max(60),
    text: z.string().max(2000, 'An answer is too long (at most 2000 characters)').optional(),
    document_path: z.string().max(300).optional(),
  })).max(10, 'Too many answers'),
});

export const RegistryQuerySchema = z.object({
  status: z.string().max(30).optional(),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

// ── Shipment requests ──────────────────────────────────────

const Place = z.object({
  address: z.string().trim().min(1, 'Enter the pickup and drop addresses').max(500, 'An address is too long'),
  lat: coordinate('Latitude', 90),
  lng: coordinate('Longitude', 180),
});

export const ShipmentRequestSchema = z.object({
  pickup: Place,
  drop: Place,
  capacity: z.number({ invalid_type_error: 'Capacity must be a number', required_error: 'Enter the load weight' })
    .positive('Load weight must be more than 0 kg')
    .max(50000, 'Load weight can be at most 50,000 kg'),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
}).refine(v => Buffer.byteLength(JSON.stringify(v.metadata), 'utf8') <= 20 * 1024, 'The load details are too large')
  .refine(v => validPlace(v.pickup.lat, v.pickup.lng) && validPlace(v.drop.lat, v.drop.lng), { message: 'Choose a real pickup and drop-off place', params: { status: 422 } })
  .refine(v => !samePlace(v.pickup.lat, v.pickup.lng, v.drop.lat, v.drop.lng), { message: 'The pickup and the drop-off are the same place', params: { status: 422 } });
export type ShipmentRequestInput = z.infer<typeof ShipmentRequestSchema>;

/** Turns a zod failure into the first message, as a 400 (422 when the check asks for it with `params.status`). */
export function parseBody<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const status = (issue as { params?: { status?: number } } | undefined)?.params?.status === 422 ? 422 : 400;
    throw new HttpError(status, issue?.message ?? 'Some details are not valid');
  }
  return parsed.data;
}
