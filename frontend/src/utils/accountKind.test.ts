import { describe, expect, it } from 'vitest'
import {
  accountKindOf, homeForKind, legacyAudiencePath, loginPathFor, nextForKind, wrongPageMessage,
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

  it('lets a vendor keep the vendor area, /ship and the public pages only', () => {
    expect(nextForKind('vendor', '/vendor/loads/5')).toBe('/vendor/loads/5')
    expect(nextForKind('vendor', '/ship')).toBe('/ship')
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

describe('sign-in addresses', () => {
  it('sends each area to its own sign-in page', () => {
    expect(loginPathFor('/vendor/loads')).toBe('/vendor/login')
    expect(loginPathFor('/vendor')).toBe('/vendor/login')
    expect(loginPathFor('/ship')).toBe('/vendor/login')
    expect(loginPathFor('/3pl-portal/p1')).toBe('/3pl/login')
    expect(loginPathFor('/today')).toBe('/login')
    expect(loginPathFor('/3pl/onboard')).toBe('/login')
  })

  it('maps the old ?as= values', () => {
    expect(legacyAudiencePath('vendor')).toBe('/vendor/login')
    expect(legacyAudiencePath('partner')).toBe('/vendor/login')
    expect(legacyAudiencePath('3pl')).toBe('/3pl/login')
    expect(legacyAudiencePath('staff')).toBeNull()
    expect(legacyAudiencePath(null)).toBeNull()
  })

  it('names the right page when the account is of another kind', () => {
    expect(wrongPageMessage('vendor', 'staff')).toEqual({
      text: 'This is the vendor sign-in. Your account is a company staff account, so use the',
      to: '/login',
      linkLabel: 'staff sign-in',
    })
    expect(wrongPageMessage('staff', 'tpl').to).toBe('/3pl/login')
  })

  it('finds each kind\'s home', () => {
    expect(homeForKind('staff', { role: 'admin' })).toBe('/today')
    expect(homeForKind('staff', { role: 'driver' })).toBe('/driver')
    expect(homeForKind('vendor', { role: 'vendor' })).toBe('/vendor/loads')
    expect(homeForKind('tpl', { role: 'vendor', tplPartnerId: 'p1' })).toBe('/3pl-portal/p1')
    expect(homeForKind('tpl', { role: 'vendor' })).toBeNull()
  })
})
