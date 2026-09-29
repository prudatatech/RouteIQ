import { describe, expect, it } from 'vitest'
import { corridorRateText, corridorToFormRow, emptyCorridorRow, normaliseDraftCorridor, rateText } from './constants'

describe('corridor rates', () => {
  it('shows a numeric rate with its unit', () => {
    expect(rateText(45000, 'per_trip')).toBe('₹45,000 per trip')
    expect(rateText('22', 'per_km')).toBe('₹22 per km')
  })

  it('shows an older text rate as written and says when there is none', () => {
    expect(rateText(null, null, 'Base + 12%')).toBe('Base + 12%')
    expect(rateText(null, null, null)).toBe('Quoted per load')
    expect(corridorRateText({ corridor_name: 'DEL-BOM', proposed_rate: 'on request' })).toBe('on request')
  })

  it('edits a numeric corridor as a number and unit', () => {
    const row = corridorToFormRow({ corridor_name: 'DEL-BOM', vehicle_types: ['32ft SXL', '20ft'], rate_amount: 22, rate_unit: 'per_km', proposed_rate: '₹22 per km', priority: 2 }, 1)
    expect(row).toMatchObject({ name: 'DEL-BOM', vehicles: '32ft SXL, 20ft', rate: '22', rate_unit: 'per_km', priority: '2' })
    expect(row.legacy_rate).toBeUndefined()
  })

  it('carries an older text rate along without turning it into a number', () => {
    const row = corridorToFormRow({ corridor_name: 'DEL-BOM', proposed_rate: 'Base + 12%' }, 1)
    expect(row).toMatchObject({ rate: '', rate_unit: 'per_trip', legacy_rate: 'Base + 12%' })
  })

  it('starts a new corridor with no rate, per trip', () => {
    expect(emptyCorridorRow()).toMatchObject({ rate: '', rate_unit: 'per_trip' })
  })

  it('reads a draft saved before rates had a unit', () => {
    expect(normaliseDraftCorridor({ id: 1, name: 'DEL-BOM', rate: '45000' })).toMatchObject({ rate: '45000', rate_unit: 'per_trip' })
    const text = normaliseDraftCorridor({ id: 2, name: 'DEL-BOM', rate: 'Base + 12%' })
    expect(text).toMatchObject({ rate: '', legacy_rate: 'Base + 12%' })
  })
})
