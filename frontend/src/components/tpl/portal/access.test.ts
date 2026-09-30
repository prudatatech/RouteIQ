import { describe, expect, it } from 'vitest'
import { legacyTabPage, portalAccess } from './access'

const OWN = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'

describe('portalAccess', () => {
  it('lets a partner open their own portal', () => {
    expect(portalAccess(OWN, OWN)).toBe('own')
    expect(portalAccess(OWN, OWN.toUpperCase())).toBe('own')
  })

  it('refuses another partner’s portal', () => {
    expect(portalAccess(OWN, OTHER)).toBe('other')
    expect(portalAccess(OWN, undefined)).toBe('other')
  })

  it('tells an account with no partner record apart', () => {
    expect(portalAccess(null, OWN)).toBe('no-partner')
    expect(portalAccess(undefined, OWN)).toBe('no-partner')
  })
})

describe('legacyTabPage', () => {
  it('maps the old tabs to the new pages', () => {
    expect(legacyTabPage('orders')).toBe('')
    expect(legacyTabPage('overview')).toBe('')
    expect(legacyTabPage('earnings')).toBe('earnings')
    expect(legacyTabPage('coverage')).toBe('lanes')
    expect(legacyTabPage('documents')).toBe('documents')
    expect(legacyTabPage('settings')).toBe('settings')
  })

  it('ignores anything else', () => {
    expect(legacyTabPage(null)).toBeNull()
    expect(legacyTabPage('nonsense')).toBeNull()
    expect(legacyTabPage('constructor')).toBeNull()
  })
})
