import { describe, expect, it } from 'vitest'
import { canOfferReturnToService, sosNextStep } from './sos'

describe('sosNextStep', () => {
  it('goes acknowledge, then resolve, then nothing', () => {
    expect(sosNextStep('active')).toBe('acknowledge')
    expect(sosNextStep('acknowledged')).toBe('resolve')
    expect(sosNextStep('resolved')).toBeNull()
    expect(sosNextStep('cancelled')).toBeNull()
  })
})

describe('canOfferReturnToService', () => {
  it('is offered only after the alert is closed and the vehicle is in maintenance', () => {
    expect(canOfferReturnToService('active', true)).toBe(false)
    expect(canOfferReturnToService('acknowledged', true)).toBe(false)
    expect(canOfferReturnToService('resolved', true)).toBe(true)
    expect(canOfferReturnToService('resolved', false)).toBe(false)
  })
})
