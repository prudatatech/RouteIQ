import { beforeEach, describe, expect, it, vi } from 'vitest'
import { groupMemberships, pickActiveOrgId, ORG_STORAGE_KEY, type Membership, type OrgKind } from './orgs'
import { orgHeaders, selectActiveMembership, useOrgStore } from '@/store/orgStore'

const m = (id: string, kind: OrgKind, name = id): Membership => ({ org: { id, kind, name, status: 'active' }, role: 'admin' })

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  })
  useOrgStore.setState({ memberships: [], activeOrgId: null, loaded: false })
})

describe('pickActiveOrgId', () => {
  it('keeps the remembered org while the user is still a member', () => {
    expect(pickActiveOrgId([m('a', 'vendor'), m('b', 'platform')], 'b')).toBe('b')
  })
  it('falls back to the first membership when the remembered org is gone or none is remembered', () => {
    expect(pickActiveOrgId([m('a', 'vendor')], 'zzz')).toBe('a')
    expect(pickActiveOrgId([m('a', 'vendor')], null)).toBe('a')
  })
  it('prefers the platform the user runs over a company when nothing is remembered', () => {
    expect(pickActiveOrgId([m('co', 'logistic_company'), m('pl', 'platform')], null)).toBe('pl')
    expect(pickActiveOrgId([m('co', 'logistic_company'), m('pl', 'platform')], 'co')).toBe('co')
  })
  it('is null for no memberships', () => {
    expect(pickActiveOrgId([], 'a')).toBeNull()
  })
})

describe('org store', () => {
  it('chooses and persists a default, then restores the remembered org', () => {
    useOrgStore.getState().setMemberships([m('a', 'vendor'), m('b', 'platform')])
    expect(useOrgStore.getState().activeOrgId).toBe('b')
    useOrgStore.getState().setActiveOrg('a')
    expect(store.get(ORG_STORAGE_KEY)).toBe('a')
    useOrgStore.setState({ memberships: [], activeOrgId: null })
    useOrgStore.getState().setMemberships([m('a', 'vendor'), m('b', 'platform')])
    expect(selectActiveMembership(useOrgStore.getState())?.org.id).toBe('a')
  })
  it('ignores a switch to an org the user is not in', () => {
    useOrgStore.getState().setMemberships([m('a', 'vendor')])
    useOrgStore.getState().setActiveOrg('x')
    expect(useOrgStore.getState().activeOrgId).toBe('a')
  })
  it('still works when storage throws', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } })
    useOrgStore.getState().setMemberships([m('a', 'vendor')])
    expect(useOrgStore.getState().activeOrgId).toBe('a')
  })
})

describe('orgHeaders', () => {
  it('sends X-Org-Id for the active org and nothing when there is none', () => {
    expect(orgHeaders()).toEqual({})
    useOrgStore.getState().setMemberships([m('a', 'vendor')])
    expect(orgHeaders()).toEqual({ 'X-Org-Id': 'a' })
    useOrgStore.getState().reset()
    expect(orgHeaders()).toEqual({})
  })
})

describe('groupMemberships', () => {
  it('groups by kind in a fixed order and drops empty groups', () => {
    const groups = groupMemberships([m('v', 'vendor'), m('t', 'tpl_partner'), m('l1', 'logistic_company'), m('l2', 'logistic_company')])
    expect(groups.map(g => g.label)).toEqual(['Logistic companies', 'Vendor', '3PL'])
    expect(groups[0].items.map(i => i.org.id)).toEqual(['l1', 'l2'])
  })
})
