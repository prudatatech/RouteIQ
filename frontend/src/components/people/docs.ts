import type { Tone } from '@/components/ui'
import { requiredDocTypes, type DocSummary, type DriverLicenceStatus, type PersonDocument } from './types'

export const EXPIRY_WARNING_DAYS = 30

/** Whole days from today until a bare date (negative when past). Null without a date. */
export function daysUntil(date: string | null | undefined, now: Date = new Date()): number | null {
  if (!date) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!m) return null
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target - today) / 86_400_000)
}

export type DocState = 'verified' | 'pending' | 'rejected' | 'expired' | 'expiring'

/** How a live document should read: expiry beats the stored status. */
export function docState(doc: PersonDocument, now?: Date): DocState {
  const days = daysUntil(doc.expires_on, now)
  if (doc.status === 'expired' || (days !== null && days < 0)) return 'expired'
  if (doc.status === 'rejected') return 'rejected'
  if (doc.status === 'pending') return 'pending'
  if (days !== null && days <= EXPIRY_WARNING_DAYS) return 'expiring'
  return 'verified'
}

export const DOC_STATE_LABEL: Record<DocState, string> = {
  verified: 'Verified', pending: 'Waiting for review', rejected: 'Rejected', expired: 'Expired', expiring: 'Expiring soon',
}
export const DOC_STATE_TONE: Record<DocState, Tone> = {
  verified: 'success', pending: 'warning', rejected: 'danger', expired: 'danger', expiring: 'warning',
}

/** Live (not archived) documents, newest first, one per type. */
export function liveDocuments(docs: PersonDocument[]): PersonDocument[] {
  const seen = new Set<string>()
  return docs
    .filter(d => !d.archived_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .filter(d => (d.doc_type === 'other' ? true : !seen.has(d.doc_type) && !!seen.add(d.doc_type)))
}

export interface Completeness {
  required: string[]
  verified: string[]
  missing: string[]
}

/** Required documents for the role, and which are verified and in date. */
export function completeness(role: string, docs: PersonDocument[]): Completeness {
  const live = liveDocuments(docs)
  const required = requiredDocTypes(role)
  const verified: string[] = []
  const missing: string[] = []
  for (const t of required) {
    const d = live.find(x => x.doc_type === t)
    if (!d) missing.push(t)
    else if (['verified', 'expiring'].includes(docState(d))) verified.push(t)
  }
  return { required, verified, missing }
}

/** "3/4 verified" with the tone that says how urgent it is. Null when no documents are required. */
export function docSummaryView(s: DocSummary | null | undefined): { text: string; tone: Tone; hint?: string } | null {
  if (!s || s.required === 0) return null
  const hint = [
    s.expired > 0 && `${s.expired} expired`,
    s.expiring > 0 && `${s.expiring} expiring`,
    s.pending > 0 && `${s.pending} waiting for review`,
    s.missing > 0 && `${s.missing} missing`,
  ].filter(Boolean).join(', ') || undefined
  const tone: Tone = s.expired > 0 ? 'danger' : s.expiring > 0 || s.pending > 0 || s.missing > 0 ? 'warning' : 'success'
  return { text: `${s.verified}/${s.required} verified`, tone, hint }
}

export function needsAttention(s: DocSummary | null | undefined): boolean {
  return !!s && (s.expired > 0 || s.expiring > 0 || s.pending > 0 || s.missing > 0)
}

export const LICENCE_WARNING: Record<'expired' | 'expiring' | 'missing', { text: string; tone: Tone }> = {
  expired: { text: 'Driver licence expired', tone: 'danger' },
  expiring: { text: 'Driver licence expiring', tone: 'warning' },
  missing: { text: 'Driver licence missing', tone: 'warning' },
}

export function licenceWarning(status: DriverLicenceStatus) {
  return status === 'expired' || status === 'expiring' || status === 'missing' ? LICENCE_WARNING[status] : null
}
