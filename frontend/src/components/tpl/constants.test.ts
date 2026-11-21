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

describe('TPL compliance documents', () => {
  it('defines the standard 11 Indian 3PL / GTA compliance document types', async () => {
    const { TPL_DOCUMENT_TYPES } = await import('./constants')
    expect(TPL_DOCUMENT_TYPES.length).toBe(11)
    expect(TPL_DOCUMENT_TYPES).toContain('PAN Card')
    expect(TPL_DOCUMENT_TYPES).toContain('GST Certificate')
    expect(TPL_DOCUMENT_TYPES).toContain('Cancelled Cheque')
    expect(TPL_DOCUMENT_TYPES).toContain('Certificate of Incorporation')
    expect(TPL_DOCUMENT_TYPES).toContain('Partnership Deed')
    expect(TPL_DOCUMENT_TYPES).toContain('Board Resolution / Letter of Authority')
    expect(TPL_DOCUMENT_TYPES).toContain('Authorized Signatory ID')
    expect(TPL_DOCUMENT_TYPES).toContain('Carriage by Road Registration')
    expect(TPL_DOCUMENT_TYPES).toContain('MSME / Udyam Certificate')
    expect(TPL_DOCUMENT_TYPES).toContain('Trade License / Shop & Establishment')
    expect(TPL_DOCUMENT_TYPES).toContain('Sample Consignment Note (LR)')
  })

  it('evaluates requirement dynamically based on entity type and MSME status', async () => {
    const { TPL_DOCUMENT_SPECS } = await import('./constants')

    // Certificate of Incorporation
    const coi = TPL_DOCUMENT_SPECS['Certificate of Incorporation']
    expect(coi.evaluateRequirement({ entityType: 'Private Limited' }).level).toBe('required')
    expect(coi.evaluateRequirement({ entityType: 'Proprietorship' }).level).toBe('optional')

    // Partnership Deed
    const deed = TPL_DOCUMENT_SPECS['Partnership Deed']
    expect(deed.evaluateRequirement({ entityType: 'Partnership' }).level).toBe('required')
    expect(deed.evaluateRequirement({ entityType: 'LLP' }).level).toBe('required')
    expect(deed.evaluateRequirement({ entityType: 'Private Limited' }).level).toBe('optional')

    // MSME Certificate
    const msme = TPL_DOCUMENT_SPECS['MSME / Udyam Certificate']
    expect(msme.evaluateRequirement({ msmeStatus: 'Small' }).level).toBe('required')
    expect(msme.evaluateRequirement({ msmeStatus: 'Not Registered' }).level).toBe('optional')

    // Carriage by Road Registration (Common Carrier Act 2007)
    const carriage = TPL_DOCUMENT_SPECS['Carriage by Road Registration']
    expect(carriage.evaluateRequirement({}).level).toBe('recommended')
    expect(carriage.evaluateRequirement({}).badgeText).toContain('Carriage by Road Act 2007')
  })
})

