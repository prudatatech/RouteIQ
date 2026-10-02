import { describe, expect, it } from 'vitest'
import { actorFor, canOpenPath, destinationForOrgs, gateFor, isPlatformActor, orgOptionLabel, waitingCopy } from './orgAccess'
import { menuFor } from '@/config/navigation'
import type { Membership, OrgKind, OrgRole } from './orgs'

const m = (kind: OrgKind, status: string, role: OrgRole = 'owner', id = `${kind}-${status}`): Membership => ({ org: { id, kind, name: id, status }, role })

describe('gateFor: which screen a user sees', () => {
  it('waits until the organisations are read', () => {
    expect(gateFor(false, null)).toBe('loading')
  })
  it('opens the normal screens with no organisation (older backend) or for the platform', () => {
    expect(gateFor(true, null)).toBe('open')
    expect(gateFor(true, m('platform', 'active'))).toBe('open')
  })
  it('opens them for an active company', () => {
    expect(gateFor(true, m('logistic_company', 'active'))).toBe('open')
  })
  it('shows only the waiting screen for a pending or rejected company', () => {
    expect(gateFor(true, m('logistic_company', 'pending'))).toBe('waiting')
    expect(gateFor(true, m('logistic_company', 'rejected'))).toBe('waiting')
  })
  it('shows the notice for a suspended company', () => {
    expect(gateFor(true, m('logistic_company', 'suspended'))).toBe('suspended')
  })
})

describe('platform and company actors', () => {
  it('is the platform actor only for an owner or admin of the active platform organisation', () => {
    expect(isPlatformActor(m('platform', 'active', 'owner'))).toBe(true)
    expect(isPlatformActor(m('platform', 'active', 'admin'))).toBe(true)
    expect(isPlatformActor(m('platform', 'active', 'ops'))).toBe(false)
    expect(isPlatformActor(m('logistic_company', 'active', 'owner'))).toBe(false)
    expect(isPlatformActor(null)).toBe(false)
  })
  it('opens /platform pages for the platform owner only', () => {
    expect(canOpenPath('/platform/organisations', m('platform', 'active'))).toBe(true)
    expect(canOpenPath('/platform/organisations', m('logistic_company', 'active'))).toBe(false)
    expect(canOpenPath('/platform/organisations', null)).toBe(false)
    expect(canOpenPath('/admin/kyc', m('logistic_company', 'active'))).toBe(false)
    expect(canOpenPath('/3pl-partners/abc', m('logistic_company', 'active'))).toBe(false)
    expect(canOpenPath('/admin/kyc', m('platform', 'active'))).toBe(true)
    expect(canOpenPath('/shipments', m('logistic_company', 'active'))).toBe(true)
    expect(canOpenPath('/shipments', m('platform', 'active'))).toBe(true)
  })
  it('puts the Platform section in the menu while acting as the platform, and not for a company', () => {
    const platform = menuFor('admin', actorFor(m('platform', 'active'))).map(s => s.label)
    expect(platform).toContain('Platform')
    expect(platform).toContain('Shipments')
    expect(platform[0]).toBe('Today')
    const company = menuFor('admin', actorFor(m('logistic_company', 'active'))).map(s => s.label)
    expect(company).not.toContain('Platform')
    expect(company).toContain('Shipments')
  })
})

describe('destinationForOrgs', () => {
  it('sends a user whose only organisation is pending or rejected to the waiting screen', () => {
    const pending = m('logistic_company', 'pending')
    expect(destinationForOrgs([pending], pending.org.id)).toBe('/waiting-for-approval')
    expect(destinationForOrgs([m('logistic_company', 'rejected')], null)).toBe('/waiting-for-approval')
  })
  it('keeps the normal destination for an active or missing organisation', () => {
    const active = m('logistic_company', 'active')
    expect(destinationForOrgs([active], active.org.id)).toBeNull()
    expect(destinationForOrgs([], null)).toBeNull()
  })
  it('follows the active organisation when there are several', () => {
    const pending = m('logistic_company', 'pending')
    const active = m('platform', 'active')
    expect(destinationForOrgs([pending, active], active.org.id)).toBeNull()
    expect(destinationForOrgs([pending, active], pending.org.id)).toBe('/waiting-for-approval')
  })
})

describe('waitingCopy and orgOptionLabel', () => {
  it('explains a pending registration', () => {
    expect(waitingCopy('pending').title).toBe('Waiting for approval')
  })
  it('shows the rejection reason, trimmed, and none when blank', () => {
    expect(waitingCopy('rejected', '  GSTIN does not match  ').reason).toBe('GSTIN does not match')
    expect(waitingCopy('rejected', '   ').reason).toBeNull()
  })
  it('marks organisations that are not working in the switcher', () => {
    expect(orgOptionLabel(m('logistic_company', 'pending', 'owner', 'Acme'))).toBe('Acme (pending)')
    expect(orgOptionLabel(m('logistic_company', 'suspended', 'owner', 'Acme'))).toBe('Acme (suspended)')
    expect(orgOptionLabel(m('logistic_company', 'active', 'owner', 'Acme'))).toBe('Acme')
  })
})
