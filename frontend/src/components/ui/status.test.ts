import { describe, expect, it } from 'vitest'
import { statusToTone } from './status'

describe('status colours', () => {
  it('does not give Created and Cancelled the same colour', () => {
    expect(statusToTone('created')).toBe('neutral')
    expect(statusToTone('cancelled')).toBe('danger')
    expect(statusToTone('cancelled')).not.toBe(statusToTone('created'))
  })
  it('keeps a cancelled booking, request and window apart from fresh ones too', () => {
    expect(statusToTone('cancelled', 'request')).toBe('danger')
    expect(statusToTone('cancelled', 'window')).toBe('danger')
    expect(statusToTone('cancelled', 'route')).toBe('danger')
  })
})
