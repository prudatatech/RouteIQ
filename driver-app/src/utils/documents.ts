import type { DocType, DocStatus, PersonDocument } from '../services/api';
import type { Tone } from '../components/ui';
import type { Language } from '../locales';

/** Documents every driver must have. */
export const REQUIRED_DOC_TYPES: DocType[] = ['driving_licence', 'aadhaar', 'pan', 'photo'];

/** Shown only when the driver already has one uploaded. */
export const OPTIONAL_DOC_TYPES: DocType[] = [
  'police_verification',
  'medical_fitness',
  'address_proof',
  'offer_letter',
  'other',
];

export const NEEDS_NUMBER: DocType[] = ['driving_licence', 'aadhaar', 'pan'];
export const NEEDS_EXPIRY: DocType[] = ['driving_licence', 'police_verification', 'medical_fitness'];
/** "Other" needs a title, which the driver cannot enter here; dispatch adds those. */
export const DRIVER_CAN_UPLOAD = (type: DocType) => type !== 'other';

export const EXPIRING_SOON_DAYS = 30;

export type DocDisplayStatus = DocStatus | 'missing';

const DATE_LOCALES: Record<Language, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  mr: 'mr-IN',
  te: 'te-IN',
  kn: 'kn-IN',
  bn: 'bn-IN',
};

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

function parseDay(value: string | null | undefined): Date | null {
  const m = value ? ISO_DAY.exec(value) : null;
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A date written for the driver's language, e.g. "31 Dec 2030" or "३१ डिसें. २०३०". Empty when unreadable. */
export function formatDocDate(value: string | null | undefined, lang: Language): string {
  const d = parseDay(value);
  if (!d) return '';
  return new Intl.DateTimeFormat(DATE_LOCALES[lang] ?? 'en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/** Whole days from today (Asia/Kolkata) to a date; negative when it has passed. Null when unreadable. */
export function daysUntil(value: string | null | undefined, now: Date = new Date()): number | null {
  const d = parseDay(value);
  if (!d) return null;
  const today = parseDay(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now));
  if (!today) return null;
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

/** Whether a date is a real YYYY-MM-DD day (rejects 2030-02-31). */
export function isValidDay(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = parseDay(value);
  return !!d && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** The status to show: a document past its expiry date is expired even before the server's daily job runs. */
export function displayStatus(doc: PersonDocument | undefined): DocDisplayStatus {
  if (!doc) return 'missing';
  const left = daysUntil(doc.expires_on);
  if (doc.status !== 'rejected' && left !== null && left < 0) return 'expired';
  return doc.status;
}

export const STATUS_TONE: Record<DocDisplayStatus, Tone> = {
  verified: 'success',
  pending: 'info',
  rejected: 'danger',
  expired: 'danger',
  missing: 'neutral',
};

/** The document each type currently has (the newest when the server sent several). */
export function currentDocuments(documents: PersonDocument[]): Map<DocType, PersonDocument> {
  const byType = new Map<DocType, PersonDocument>();
  for (const doc of documents) {
    const seen = byType.get(doc.doc_type);
    if (!seen || (doc.created_at ?? '') > (seen.created_at ?? '')) byType.set(doc.doc_type, doc);
  }
  return byType;
}

/** Aadhaar is 12 digits; PAN is AAAAA9999A. */
export function isValidDocNumber(type: DocType, value: string): boolean {
  if (type === 'aadhaar') return /^\d{12}$/.test(value.replace(/\s/g, ''));
  if (type === 'pan') return /^[A-Z]{5}\d{4}[A-Z]$/.test(value);
  return value.trim().length >= 5;
}
