import type { CsvColumn } from '@/utils/csv'
import type { OrgKind, OrgRow, OrgStatus } from './orgs'

export const PLATFORM_ORG_TABS: { id: Exclude<OrgKind, 'platform'>; label: string }[] = [
  { id: 'logistic_company', label: 'Logistic companies' },
  { id: 'vendor', label: 'Vendors' },
  { id: 'tpl_partner', label: '3PL partners' },
]

export type StatusFilter = 'pending' | 'all' | OrgStatus

/** Pending first: waiting companies lead the filter, then everything. */
export const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'pending', label: 'Waiting for approval' },
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'rejected', label: 'Rejected' },
]

export const ORG_STATUS_LABELS: Record<OrgStatus, string> = {
  pending: 'Waiting for approval', active: 'Active', suspended: 'Suspended', rejected: 'Rejected',
}

export const PAGE_SIZE = 25

export function listParams(kind: OrgKind, status: StatusFilter, page: number, limit = PAGE_SIZE) {
  return { kind, ...(status === 'all' ? {} : { status }), limit, offset: Math.max(0, page) * limit }
}

const RANK: Record<OrgStatus, number> = { pending: 0, suspended: 1, active: 2, rejected: 3 }

/** Waiting organisations first, then newest first (the order the server returns). Does not change the input. */
export function pendingFirst(rows: OrgRow[]): OrgRow[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => RANK[a.r.status] - RANK[b.r.status] || a.i - b.i)
    .map(x => x.r)
}

export type Decision = 'approve' | 'reject' | 'suspend'

/** The decisions the API accepts for a status (reinstate is approve on a suspended organisation). */
export function decisionsFor(status: OrgStatus, kind: OrgKind): { decision: Decision; label: string }[] {
  if (kind === 'platform') return []
  if (status === 'pending') return [{ decision: 'approve', label: 'Approve' }, { decision: 'reject', label: 'Reject' }]
  if (status === 'active') return [{ decision: 'suspend', label: 'Suspend' }]
  if (status === 'suspended') return [{ decision: 'approve', label: 'Reinstate' }]
  return []
}

export function pageRange(total: number, limit: number, offset: number): { from: number; to: number; hasPrev: boolean; hasNext: boolean } {
  if (total <= 0) return { from: 0, to: 0, hasPrev: false, hasNext: false }
  const from = offset + 1
  const to = Math.min(offset + limit, total)
  return { from, to, hasPrev: offset > 0, hasNext: offset + limit < total }
}

/** The reason an organisation was rejected or suspended, kept in its profile by the server. */
export function decisionReason(org: Pick<OrgRow, 'status' | 'profile'>): string | null {
  const key = org.status === 'rejected' ? 'reject_reason' : org.status === 'suspended' ? 'suspend_reason' : null
  const value = key ? org.profile?.[key] : null
  return typeof value === 'string' && value.trim() ? value : null
}

export const ORG_CSV_COLUMNS: CsvColumn[] = [
  { key: 'name', header: 'Name' },
  { key: 'legal_name', header: 'Legal name' },
  { key: 'status', header: 'Status' },
  { key: 'gstin', header: 'GSTIN' },
  { key: 'pan', header: 'PAN' },
  { key: 'city', header: 'City' },
  { key: 'state', header: 'State' },
  { key: 'phone', header: 'Phone' },
  { key: 'email', header: 'Email' },
  { key: 'registered', header: 'Registered' },
]

export function orgCsvRows(rows: OrgRow[]): Record<string, string | null>[] {
  return rows.map(r => ({
    name: r.name,
    legal_name: r.legal_name ?? null,
    status: ORG_STATUS_LABELS[r.status] ?? r.status,
    gstin: r.gstin ?? null,
    pan: r.pan ?? null,
    city: r.city ?? null,
    state: r.state ?? null,
    phone: r.phone ?? null,
    email: r.email ?? null,
    registered: r.created_at ? r.created_at.slice(0, 10) : null,
  }))
}
