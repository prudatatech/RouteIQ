import { describe, expect, it } from 'vitest'
import { LICENCE_NOTE } from './licenceNote'

// The status wording these are the heads-up form of (components/people/docs.ts), kept here as plain tones
const LICENCE_WARNING = { expired: { tone: 'danger' }, expiring: { tone: 'warning' }, missing: { tone: 'warning' } } as const

describe('licence wording in the vehicle list', () => {
  it('has a heads-up for every licence warning, with the same tone', () => {
    for (const key of ['expired', 'expiring', 'missing'] as const) {
      expect(LICENCE_NOTE[key].tone).toBe(LICENCE_WARNING[key].tone)
    }
  })
  it('says "not on file" rather than a verdict that clashes with "can take this"', () => {
    expect(LICENCE_NOTE.missing.text).toBe('Licence not on file')
  })
})
