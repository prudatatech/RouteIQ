import { describe, expect, it } from 'vitest'
import {
  accountKindOf, homeForKind, LOGIN_PATH, nextForKind,
} from './accountKind'
import type { Membership, OrgKind } from './orgs'

const member = (kind: OrgKind, status = 'active'): Membership => ({ org: { id: `o-${kind}`, kind, name: kind, status }, role: 'owner' })

describe('accountKindOf', () => {
  it('treats superadmin, admin, manager and driver as staff', () => {
    for (const role of ['superadmin', 'admin', 'manager', 'driver']) expect(accountKindOf({ role })).toBe('staff')
  })

  it('treats a vendor without a 3PL partner as a vendor', () => {
    expect(accountKindOf({ role: 'vendor', tplPartnerId: null })).toBe('vendor')
    expect(accountKindOf({ role: 'vendor' }, [member('vendor')])).toBe('vendor')
  })

  it('treats a 3PL partner record or an active 3PL membership as tpl', () => {
    expect(accountKindOf({ role: 'vendor', tplPartnerId: 'p1' })).toBe('tpl')
    expect(accountKindOf({ role: 'vendor' }, [member('tpl_partner')])).toBe('tpl')
    expect(accountKindOf({ role: 'vendor' }, [member('tpl_partner', 'pending')])).toBe('vendor')
  })

  it('treats a member of a logistic company or the platform as staff, even while the company waits for approval', () => {
    expect(accountKindOf({ role: 'vendor' }, [member('logistic_company', 'pending')])).toBe('staff')
    expect(accountKindOf({ role: 'vendor' }, [member('platform')])).toBe('staff')
  })

  it('lets a staff role win over a partner record, and gives nothing to an account without a role', () => {
    expect(accountKindOf({ role: 'admin', tplPartnerId: 'p1' })).toBe('staff')
    expect(accountKindOf({ role: null })).toBeNull()
    expect(accountKindOf({ role: 'customer' })).toBeNull()
  })
})

describe('nextForKind', () => {
  it('lets staff keep their own pages but not the vendor or 3PL areas', () => {
    expect(nextForKind('staff', '/shipments?tab=open')).toBe('/shipments?tab=open')
    expect(nextForKind('staff', '/vendor/loads')).toBeNull()
    expect(nextForKind('staff', '/vendor/request?resume=1')).toBeNull()
    expect(nextForKind('staff', '/ship')).toBeNull()
    expect(nextForKind('staff', '/3pl-portal/p1/orders')).toBeNull()
  })

  it('lets a vendor keep their area and public pages, migrating old lane-search links', () => {
    expect(nextForKind('vendor', '/vendor/loads/5')).toBe('/vendor/loads/5')
    expect(nextForKind('vendor', '/ship')).toBe('/vendor/request')
    expect(nextForKind('vendor', '/ship?from=Pune')).toBe('/vendor/request')
    expect(nextForKind('vendor', '/vendor/request?resume=1')).toBe('/vendor/request?resume=1')
    expect(nextForKind('vendor', '/vendor/return-trips?bid=1&resume=1')).toBe('/vendor/return-trips?bid=1&resume=1')
    expect(nextForKind('vendor', '/track/ABC')).toBe('/track/ABC')
    expect(nextForKind('vendor', '/today')).toBeNull()
    expect(nextForKind('vendor', '/3pl-portal/p1')).toBeNull()
  })

  it('lets a 3PL partner keep only the partner portal', () => {
    expect(nextForKind('tpl', '/3pl-portal/p1/earnings')).toBe('/3pl-portal/p1/earnings')
    expect(nextForKind('tpl', '/vendor/loads')).toBeNull()
    expect(nextForKind('tpl', '/today')).toBeNull()
  })

  it('keeps the open-redirect guard', () => {
    for (const kind of ['staff', 'vendor', 'tpl'] as const) {
      expect(nextForKind(kind, '//evil.example/x')).toBeNull()
      expect(nextForKind(kind, 'https://evil.example')).toBeNull()
      expect(nextForKind(kind, '/\\evil')).toBeNull()
      expect(nextForKind(kind, null)).toBeNull()
    }
    expect(nextForKind(null, '/today')).toBeNull()
  })
})

describe('sign-in address', () => {
  it('is one page for every kind of account', () => {
    expect(LOGIN_PATH).toBe('/login')
  })

  it('finds each kind\'s home', () => {
    expect(homeForKind('staff', { role: 'admin' })).toBe('/today')
    expect(homeForKind('staff', { role: 'driver' })).toBe('/driver')
    expect(homeForKind('vendor', { role: 'vendor' })).toBe('/vendor/loads')
    expect(homeForKind('tpl', { role: 'vendor', tplPartnerId: 'p1' })).toBe('/3pl-portal/p1')
    expect(homeForKind('tpl', { role: 'vendor' })).toBeNull()
  })
})
