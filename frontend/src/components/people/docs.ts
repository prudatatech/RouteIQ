import type { Tone } from '@/components/ui'
import { maskAadhaar } from './validators'
import { requiredGroups, type DocSummary, type DriverLicenceStatus, type PersonDocument, type RequiredGroup } from './types'

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

export type DocState = 'verified' | 'pending' | 'rejected' | 'expired' | 'expiring' | 'grace' | 'review_due'

/** How a live document should read: expiry beats the stored status. */
export function docState(doc: PersonDocument, now?: Date): DocState {
  const days = daysUntil(doc.expires_on, now)
  const expired = doc.status === 'expired' || (days !== null && days < 0)
  if (expired) return doc.in_grace ? 'grace' : 'expired'
  if (doc.status === 'rejected') return 'rejected'
  if (doc.status === 'pending') return 'pending'
  if (days !== null && days <= EXPIRY_WARNING_DAYS) return 'expiring'
  const review = daysUntil(doc.review_by, now)
  if (review !== null && review <= EXPIRY_WARNING_DAYS) return 'review_due'
  return 'verified'
}

export const DOC_STATE_LABEL: Record<DocState, string> = {
  verified: 'Verified', pending: 'Waiting for review', rejected: 'Rejected', expired: 'Expired', expiring: 'Expiring soon',
  grace: 'Expired, in grace period', review_due: 'Review due',
}
export const DOC_STATE_TONE: Record<DocState, Tone> = {
  verified: 'success', pending: 'warning', rejected: 'danger', expired: 'danger', expiring: 'warning', grace: 'warning', review_due: 'warning',
}

/** Live (not archived) documents, newest first, one per type. */
export function liveDocuments(docs: PersonDocument[]): PersonDocument[] {
  const seen = new Set<string>()
  return docs
    .filter(d => !d.archived_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .filter(d => (d.doc_type === 'other' ? true : !seen.has(d.doc_type) && !!seen.add(d.doc_type)))
}

export interface GroupStatus {
  group: RequiredGroup
  /** The live document that satisfies (or is closest to satisfying) the group. */
  doc: PersonDocument | null
  state: DocState | 'missing' | 'waived'
  /** Verified and in date. */
  ok: boolean
}

/** Each required group for the role: satisfied by any one of its document types. */
export function groupStatuses(role: string, docs: PersonDocument[], noPanReason?: string | null): GroupStatus[] {
  const live = liveDocuments(docs)
  return requiredGroups(role).map(group => {
    const found = live.filter(d => group.types.includes(d.doc_type)).map(doc => ({ doc, state: docState(doc) }))
    const good = found.find(f => ['verified', 'expiring', 'review_due'].includes(f.state))
    const best = good ?? found[0]
    if (best) return { group, doc: best.doc, state: best.state, ok: !!good }
    if (group.waivable && noPanReason?.trim()) return { group, doc: null, state: 'waived' as const, ok: true }
    return { group, doc: null, state: 'missing' as const, ok: false }
  })
}

export function completeness(role: string, docs: PersonDocument[], noPanReason?: string | null) {
  const groups = groupStatuses(role, docs, noPanReason)
  return { groups, required: groups.length, verified: groups.filter(g => g.ok).length, missing: groups.filter(g => g.state === 'missing') }
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

/** Aadhaar shows only its last four digits, whatever the API sends. */
export function maskedNumber(doc: PersonDocument) {
  if (!doc.doc_number && !doc.number_last4) return null
  return doc.doc_type === 'aadhaar' ? maskAadhaar(doc.doc_number, doc.number_last4) : doc.doc_number
}

/** The same warning as plain text, for places that only take text (a dropdown option). */
export function licenceSuffix(status: DriverLicenceStatus): string {
  const warning = licenceWarning(status)
  return warning ? ` · ${warning.text}` : ''
}
