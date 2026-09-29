import type { DocType, DocStatus, PersonDocument } from '../services/api';
import type { Tone } from '../components/ui';
import type { Language } from '../locales';

/**
 * What a driver must have. Identity proof is a group: one of Aadhaar, voter ID
 * or passport is enough. The tax ID is PAN.
 */
export type DocSlot = { key: string; types: DocType[]; group?: 'identity' };

export const IDENTITY_TYPES: DocType[] = ['aadhaar', 'voter_id', 'passport'];

export const REQUIRED_SLOTS: DocSlot[] = [
  { key: 'identity', types: IDENTITY_TYPES, group: 'identity' },
  { key: 'driving_licence', types: ['driving_licence'] },
  { key: 'pan', types: ['pan'] },
  { key: 'photo', types: ['photo'] },
];

/** Shown only when the driver already has one uploaded. */
export const OPTIONAL_DOC_TYPES: DocType[] = [
  'police_verification',
  'medical_fitness',
  'address_proof',
  'offer_letter',
  'other',
];

export const NEEDS_NUMBER: DocType[] = ['driving_licence', 'aadhaar', 'pan', 'voter_id', 'passport'];
export const NEEDS_EXPIRY: DocType[] = ['driving_licence', 'police_verification', 'medical_fitness'];
/** "Other" needs a title, which the driver cannot enter here; dispatch adds those. */
export const DRIVER_CAN_UPLOAD = (type: DocType) => type !== 'other';

export const EXPIRING_SOON_DAYS = 30;

export type DocDisplayStatus = DocStatus | 'grace' | 'missing' | 'waiting';

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

/**
 * The status to show. A document past its expiry date is expired even before
 * the server's daily job runs; when the server says it is in its grace period
 * that is shown instead. A file waiting on the phone to be uploaded shows as
 * waiting when there is no document yet.
 */
export function displayStatus(doc: PersonDocument | undefined, waiting = false): DocDisplayStatus {
  if (!doc) return waiting ? 'waiting' : 'missing';
  const left = daysUntil(doc.expires_on);
  const expired = doc.status === 'expired' || (doc.status !== 'rejected' && left !== null && left < 0);
  if (expired) return doc.in_grace ? 'grace' : 'expired';
  return doc.status;
}

export const STATUS_TONE: Record<DocDisplayStatus, Tone> = {
  verified: 'success',
  pending: 'info',
  rejected: 'danger',
  expired: 'danger',
  grace: 'warning',
  missing: 'neutral',
  waiting: 'info',
};

/** How urgent a "review by" date is: null when far off or absent. */
export function reviewState(doc: PersonDocument | undefined): { due: boolean; days: number } | null {
  const days = daysUntil(doc?.review_by);
  if (days === null || days > EXPIRING_SOON_DAYS) return null;
  return { due: days <= 0, days };
}

/** The document each type currently has (the newest when the server sent several). */
export function currentDocuments(documents: PersonDocument[]): Map<DocType, PersonDocument> {
  const byType = new Map<DocType, PersonDocument>();
  for (const doc of documents) {
    const seen = byType.get(doc.doc_type);
    if (!seen || (doc.created_at ?? '') > (seen.created_at ?? '')) byType.set(doc.doc_type, doc);
  }
  return byType;
}

/** For an alternatives group: the document that best satisfies it (verified first, then the newest). */
export function bestOf(current: Map<DocType, PersonDocument>, types: DocType[]): PersonDocument | undefined {
  const rank = (d: PersonDocument) => (displayStatus(d) === 'verified' ? 2 : displayStatus(d) === 'pending' ? 1 : 0);
  let best: PersonDocument | undefined;
  for (const type of types) {
    const d = current.get(type);
    if (d && (!best || rank(d) > rank(best))) best = d;
  }
  return best;
}

/** Formats: Aadhaar 12 digits, PAN AAAAA9999A, voter ID 3 letters and 7 digits, passport a letter and 7 digits. */
export function isValidDocNumber(type: DocType, value: string): boolean {
  if (type === 'aadhaar') return /^\d{12}$/.test(value.replace(/\s/g, ''));
  if (type === 'pan') return /^[A-Z]{5}\d{4}[A-Z]$/.test(value);
  if (type === 'voter_id') return /^[A-Z]{3}\d{7}$/.test(value);
  if (type === 'passport') return /^[A-Z]\d{7}$/.test(value);
  return value.trim().length >= 5;
}

/** The number as shown in the app. Aadhaar is never shown in full: "XXXX XXXX 1234". */
export function displayNumber(doc: PersonDocument): string | null {
  if (doc.doc_type === 'aadhaar') {
    const last4 = (doc.number_last4 ?? doc.doc_number?.replace(/\D/g, '').slice(-4) ?? '').slice(-4);
    return last4.length === 4 ? `XXXX XXXX ${last4}` : null;
  }
  return doc.doc_number || null;
}
