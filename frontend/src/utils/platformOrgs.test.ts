import { describe, expect, it } from 'vitest'
import { decisionReason, decisionsFor, listParams, orgCsvRows, pageRange, pendingFirst, reviewLinkFor } from './platformOrgs'
import type { OrgRow, OrgStatus } from './orgs'

const row = (id: string, status: OrgStatus, extra: Partial<OrgRow> = {}): OrgRow => ({ id, kind: 'logistic_company', name: id, status, ...extra })

describe('listParams', () => {
  it('asks for one kind, one status and the page offset', () => {
    expect(listParams('vendor', 'pending', 2, 25)).toEqual({ kind: 'vendor', status: 'pending', limit: 25, offset: 50 })
  })
  it('leaves the status out for All', () => {
    expect(listParams('logistic_company', 'all', 0)).toEqual({ kind: 'logistic_company', limit: 25, offset: 0 })
  })
})

describe('pendingFirst', () => {
  it('lists waiting organisations first and keeps the server order inside a status', () => {
    const rows = [row('a', 'active'), row('b', 'pending'), row('c', 'rejected'), row('d', 'pending'), row('e', 'suspended')]
    expect(pendingFirst(rows).map(r => r.id)).toEqual(['b', 'd', 'e', 'a', 'c'])
  })
  it('does not change its input', () => {
    const rows = [row('a', 'active'), row('b', 'pending')]
    pendingFirst(rows)
    expect(rows.map(r => r.id)).toEqual(['a', 'b'])
  })
})

describe('decisionsFor', () => {
  it('approves or rejects a pending company', () => {
    expect(decisionsFor('pending', 'logistic_company').map(d => d.label)).toEqual(['Approve', 'Reject'])
  })
  it('suspends an active company and reinstates a suspended one', () => {
    expect(decisionsFor('active', 'logistic_company')).toEqual([{ decision: 'suspend', label: 'Suspend' }])
    expect(decisionsFor('suspended', 'logistic_company')).toEqual([{ decision: 'approve', label: 'Reinstate' }])
  })
  it('offers nothing for a rejected organisation or the platform', () => {
    expect(decisionsFor('rejected', 'logistic_company')).toEqual([])
    expect(decisionsFor('active', 'platform')).toEqual([])
  })
  it('omits approve for a pending logistic company that has not submitted its KYC', () => {
    expect(decisionsFor('pending', 'logistic_company', false).map(d => d.label)).toEqual(['Reject'])
    expect(decisionsFor('pending', 'logistic_company', true).map(d => d.label)).toEqual(['Approve', 'Reject'])
  })
  it('offers nothing for a vendor or 3PL partner, at any status - their organisation row is only a mirror of the real KYC review', () => {
    for (const status of ['pending', 'active', 'suspended', 'rejected'] as const) {
      expect(decisionsFor(status, 'vendor')).toEqual([])
      expect(decisionsFor(status, 'tpl_partner')).toEqual([])
    }
  })
})

describe('reviewLinkFor', () => {
  it('points a vendor at its KYC review page, using the legacy user id', () => {
    expect(reviewLinkFor({ kind: 'vendor', profile: { legacy_user_id: 'v1' } })).toBe('/admin/kyc/v1')
  })
  it('points a 3PL partner at its partner page, using the legacy partner id', () => {
    expect(reviewLinkFor({ kind: 'tpl_partner', profile: { legacy_tpl_partner_id: 't1' } })).toBe('/3pl-partners/t1')
  })
  it('is null without the legacy id, or for a logistic company or the platform', () => {
    expect(reviewLinkFor({ kind: 'vendor', profile: {} })).toBeNull()
    expect(reviewLinkFor({ kind: 'vendor', profile: null })).toBeNull()
    expect(reviewLinkFor({ kind: 'logistic_company', profile: { legacy_user_id: 'x' } })).toBeNull()
    expect(reviewLinkFor({ kind: 'platform', profile: null })).toBeNull()
  })
})

describe('pageRange', () => {
  it('describes the first, a middle and the last page', () => {
    expect(pageRange(60, 25, 0)).toEqual({ from: 1, to: 25, hasPrev: false, hasNext: true })
    expect(pageRange(60, 25, 25)).toEqual({ from: 26, to: 50, hasPrev: true, hasNext: true })
    expect(pageRange(60, 25, 50)).toEqual({ from: 51, to: 60, hasPrev: true, hasNext: false })
  })
  it('is empty with no rows', () => {
    expect(pageRange(0, 25, 0)).toEqual({ from: 0, to: 0, hasPrev: false, hasNext: false })
  })
})

describe('decisionReason', () => {
  it('reads the reason the server keeps in the profile for the current status', () => {
    expect(decisionReason({ status: 'rejected', profile: { reject_reason: 'PAN mismatch' } })).toBe('PAN mismatch')
    expect(decisionReason({ status: 'suspended', profile: { suspend_reason: 'Unpaid' } })).toBe('Unpaid')
  })
  it('is null for other statuses or no reason', () => {
    expect(decisionReason({ status: 'active', profile: { reject_reason: 'old' } })).toBeNull()
    expect(decisionReason({ status: 'rejected', profile: null })).toBeNull()
  })
})

describe('orgCsvRows', () => {
  it('uses the labels people read and a plain date', () => {
    const [r] = orgCsvRows([row('Acme', 'pending', { gstin: '27AAAAA0000A1Z5', created_at: '2026-10-01T08:00:00Z' })])
    expect(r).toMatchObject({ name: 'Acme', status: 'Waiting for approval', gstin: '27AAAAA0000A1Z5', registered: '2026-10-01', city: null })
  })
})
