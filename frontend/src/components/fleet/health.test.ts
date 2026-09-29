import { describe, expect, it } from 'vitest'
import { alertTypeLabel, apiErrorMessage, bandLabel, bandTone, formatOdometer } from './health'

describe('fleet health labels', () => {
  it('shows an unknown odometer as unknown, never as 0', () => {
    expect(formatOdometer(null)).toBe('Unknown')
    expect(formatOdometer(undefined)).toBe('Unknown')
    expect(formatOdometer(48210.4)).toBe('48,210 km')
  })

  it('labels a vehicle without enough data plainly', () => {
    expect(bandLabel.unknown).toBe('Not enough data')
    expect(bandTone.unknown).toBe('neutral')
    expect(bandTone.poor).toBe('danger')
  })

  it('names alarm types in plain words', () => {
    expect(alertTypeLabel('harsh_braking')).toBe('Harsh braking')
    expect(alertTypeLabel('gps_lost')).toBe('GPS lost')
    expect(alertTypeLabel('some_new_type')).toBe('some new type')
  })

  it('reads the server message from an API error', () => {
    expect(apiErrorMessage({ response: { data: { detail: 'Vehicle not found' } } }, 'fallback')).toBe('Vehicle not found')
    expect(apiErrorMessage(new Error('x'), 'fallback')).toBe('fallback')
  })
})
