import { describe, expect, it } from 'vitest'
import { safeNextPath } from './safeNext'

describe('safeNextPath', () => {
  it('keeps same-origin paths with query and hash', () => {
    expect(safeNextPath('/vendor/shipments')).toBe('/vendor/shipments')
    expect(safeNextPath('/routes/42?tab=stops#map')).toBe('/routes/42?tab=stops#map')
  })

  it('rejects anything that could leave the site', () => {
    for (const bad of [
      'https://evil.example', '//evil.example', '/\\evil.example', '\\\\evil.example',
      'javascript:alert(1)', 'evil.example/path', ' //evil.example', '/\tevil',
    ]) {
      expect(safeNextPath(bad)).toBeNull()
    }
    // Encoded characters stay inside the path.
    expect(safeNextPath('/%2F%2Fevil.example')).toBe('/%2F%2Fevil.example')
  })

  it('rejects empty values and the sign-in pages themselves', () => {
    expect(safeNextPath(null)).toBeNull()
    expect(safeNextPath('')).toBeNull()
    expect(safeNextPath('/login')).toBeNull()
    expect(safeNextPath('/login/')).toBeNull()
    expect(safeNextPath('/vendor/login?next=/x')).toBeNull()
  })
})
