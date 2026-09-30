import type { BookingCargo, Claim, ClaimType, Tracking } from '../services/api';
import type { Tone } from '../components/ui';
import type { TranslateFn } from '../hooks/useTranslation';

/** A customer can raise a claim up to this many days after delivery (the backend enforces the same limit). */
export const CLAIM_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export const CLAIM_TYPES: ClaimType[] = ['damage', 'shortage', 'loss', 'theft', 'delay'];

/** Claim statuses in plain words (translation keys) and the tone of their pill. */
export const CLAIM_STATUS: Partial<Record<string, { label: string; tone: Tone }>> = {
  draft: { label: 'claim_status_draft', tone: 'neutral' },
  filed: { label: 'claim_status_filed', tone: 'info' },
  surveyed: { label: 'claim_status_surveyed', tone: 'info' },
  approved: { label: 'claim_status_approved', tone: 'success' },
  rejected: { label: 'claim_status_rejected', tone: 'danger' },
  settled: { label: 'claim_status_settled', tone: 'success' },
  withdrawn: { label: 'claim_status_withdrawn', tone: 'neutral' },
};

/** Condition codes the driver or hub records, as translation keys. */
const CONDITION_LABEL: Partial<Record<string, string>> = {
  good: 'condition_good',
  damaged_packaging: 'condition_damaged_packaging',
  damaged_goods: 'condition_damaged_goods',
  wet: 'condition_wet',
  seal_tampered: 'condition_seal_tampered',
  shortage: 'condition_shortage',
  excess: 'condition_excess',
};

export const conditionText = (condition: string, t: TranslateFn) => t(CONDITION_LABEL[condition] ?? 'condition_other');

/** "1 piece" or "12 pieces". */
export const piecesText = (n: number, t: TranslateFn) => (n === 1 ? t('pieces_one') : t('pieces_n', { n }));

/** When the goods were handed over: the POD, else the delivery event, else the shipment's history. */
export function deliveredAt(cargo: BookingCargo | null | undefined, tracking: Tracking | null | undefined): string | null {
  if (cargo?.pod?.delivered_at) return cargo.pod.delivered_at;
  const events = cargo?.timeline ?? [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if ((e.kind === 'delivery' || e.kind === 'partial_delivery') && e.recorded_at) return e.recorded_at;
  }
  return tracking?.history.find((h) => h.status === 'delivered')?.at ?? null;
}

/** Whether a claim can still be raised, `null` when the delivery time is not known. */
export function claimWindowOpen(delivered: string | null, now: number): boolean | null {
  if (!delivered) return null;
  const at = new Date(delivered).getTime();
  if (!Number.isFinite(at)) return null;
  return now - at <= CLAIM_WINDOW_DAYS * DAY_MS;
}

/** The last moment a claim can be raised. */
export function claimClosesAt(delivered: string | null): string | null {
  const at = delivered ? new Date(delivered).getTime() : NaN;
  return Number.isFinite(at) ? new Date(at + CLAIM_WINDOW_DAYS * DAY_MS).toISOString() : null;
}

/** Claims from the list endpoint and the cargo response, once each; the list is newer so it wins. Newest first. */
export function mergeClaims(listed: Claim[] | undefined, fromCargo: Claim[] | undefined): Claim[] {
  const byId = new Map<string, Claim>();
  for (const c of fromCargo ?? []) byId.set(c.id, c);
  for (const c of listed ?? []) byId.set(c.id, c);
  const time = (c: Claim) => (c.created_at ? new Date(c.created_at).getTime() || 0 : 0);
  return [...byId.values()].sort((a, b) => time(b) - time(a));
}
