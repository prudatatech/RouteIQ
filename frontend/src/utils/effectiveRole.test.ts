import { beforeEach, describe, expect, it } from 'vitest'
import { effectiveRoleOf, isStaffRole, roleCanOpen } from './effectiveRole'
import { useOrgStore } from '@/store/orgStore'
import type { Membership } from './orgs'

const company: Membership = { org: { id: 'c1', kind: 'logistic_company', name: 'Alpha', status: 'active' }, role: 'owner', app_role: 'admin' }
const pending: Membership = { org: { id: 'c2', kind: 'logistic_company', name: 'Newco', status: 'pending' }, role: 'owner', app_role: 'vendor' }
const desk: Membership = { org: { id: 'c3', kind: 'logistic_company', name: 'Beta', status: 'active' }, role: 'ops', app_role: 'manager' }
const platform: Membership = { org: { id: 'p1', kind: 'platform', name: 'MargixIndia', status: 'active' }, role: 'owner', app_role: 'superadmin' }

const OPERATIONS = ['superadmin', 'admin', 'manager']
const ADMINS = ['superadmin', 'admin']

describe('the role a person has in the active organisation', () => {
  it('is the role the active membership grants, not the account role', () => {
    expect(effectiveRoleOf('vendor', [company], 'c1')).toBe('admin')
    expect(effectiveRoleOf('vendor', [desk], 'c3')).toBe('manager')
    expect(effectiveRoleOf('superadmin', [platform, company], 'c1')).toBe('admin')
    expect(effectiveRoleOf('admin', [platform, company], 'p1')).toBe('superadmin')
  })

  it('follows the organisation switch', () => {
    const all = [company, desk, platform]
    expect(effectiveRoleOf('vendor', all, 'c3')).toBe('manager')
    expect(effectiveRoleOf('vendor', all, 'p1')).toBe('superadmin')
  })

  it('gives no staff role while the company is pending', () => {
    expect(effectiveRoleOf('vendor', [pending], 'c2')).toBe('vendor')
    expect(isStaffRole(effectiveRoleOf('vendor', [pending], 'c2'))).toBe(false)
  })

  it('falls back to the account role without an active membership or an older backend', () => {
    expect(effectiveRoleOf('admin', [], null)).toBe('admin')
    expect(effectiveRoleOf('manager', [company], null)).toBe('manager')
    expect(effectiveRoleOf('admin', [{ ...company, app_role: undefined }], 'c1')).toBe('admin')
    expect(effectiveRoleOf(null, [], null)).toBeNull()
  })
})

describe('the route guard with the effective role', () => {
  it('opens the operations screens for the owner of an approved company who signed up as a vendor', () => {
    const role = effectiveRoleOf('vendor', [company], 'c1')
    expect(roleCanOpen(role, OPERATIONS)).toBe(true)
    expect(roleCanOpen(role, ADMINS)).toBe(true)
  })

  it('opens operations but not Money for a company manager', () => {
    const role = effectiveRoleOf('vendor', [desk], 'c3')
    expect(roleCanOpen(role, OPERATIONS)).toBe(true)
    expect(roleCanOpen(role, ADMINS)).toBe(false)
  })

  it('keeps a pending company out of operations', () => {
    expect(roleCanOpen(effectiveRoleOf('vendor', [pending], 'c2'), OPERATIONS)).toBe(false)
  })

  it('keeps vendor pages for the vendor role, and lets any signed-in role into an unrestricted route', () => {
    expect(roleCanOpen('admin', ['vendor'])).toBe(false)
    expect(roleCanOpen('vendor', ['vendor'])).toBe(true)
    expect(roleCanOpen(null, undefined)).toBe(true)
    expect(roleCanOpen(null, OPERATIONS)).toBe(false)
  })

  it('re-reads when the organisation switches in the store', () => {
    useOrgStore.getState().setMemberships([company, pending])
    useOrgStore.getState().setActiveOrg('c1')
    const read = () => effectiveRoleOf('vendor', useOrgStore.getState().memberships, useOrgStore.getState().activeOrgId)
    expect(read()).toBe('admin')
    useOrgStore.getState().setActiveOrg('c2')
    expect(read()).toBe('vendor')
  })
})

beforeEach(() => useOrgStore.getState().reset())
