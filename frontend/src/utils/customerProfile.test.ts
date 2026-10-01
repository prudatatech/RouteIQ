import { describe, expect, it } from 'vitest'
import { GST_STATES, customerLabel, profileChanges, profileToForm, validateProfile, type CustomerProfile } from './customerProfile'

const saved: CustomerProfile = {
  id: 'c1', phone: '+919800007701', full_name: 'Asha Rao', company_name: null, gstin: null, email: null, billing_address: null,
  city: null, state: null, pincode: null, display_name: 'Asha Rao', billing_ready: false,
}

describe('customer profile form', () => {
  it('starts from what is saved, with empty text for what is not', () => {
    expect(profileToForm(saved)).toMatchObject({ full_name: 'Asha Rao', company_name: '', gstin: '' })
    expect(profileToForm(null).state).toBe('')
  })

  it('sends only what changed, trimmed, and an empty string to clear', () => {
    const form = { ...profileToForm(saved), company_name: '  Rao Traders ', full_name: '' }
    expect(profileChanges(form, saved)).toEqual({ company_name: 'Rao Traders', full_name: '' })
    expect(profileChanges(profileToForm(saved), saved)).toEqual({})
  })

  it('upper-cases the GSTIN and removes spaces', () => {
    expect(profileChanges({ ...profileToForm(saved), gstin: ' 27aapfu0939f1zv ' }, saved)).toEqual({ gstin: '27AAPFU0939F1ZV' })
  })

  it('accepts empty values and checks the rest', () => {
    expect(validateProfile(profileToForm(saved))).toEqual({})
    const errors = validateProfile({ ...profileToForm(saved), gstin: '27AAPFU0939F1ZX', pincode: '4100', email: 'nope' })
    expect(Object.keys(errors).sort()).toEqual(['email', 'gstin', 'pincode'])
    expect(validateProfile({ ...profileToForm(saved), gstin: '27AAPFU0939F1ZV', pincode: '410206', email: 'a@b.in', state: 'Maharashtra' })).toEqual({})
  })

  it('lists the GST states', () => {
    expect(GST_STATES).toHaveLength(36)
    expect(GST_STATES).toContain('Dadra and Nagar Haveli and Daman and Diu')
  })
})

describe('customerLabel', () => {
  it('uses the company, else the name, else the phone', () => {
    expect(customerLabel({ company_name: 'Rao Traders', full_name: 'Asha' })).toBe('Rao Traders')
    expect(customerLabel({ full_name: 'Asha Rao' })).toBe('Asha Rao')
    expect(customerLabel({ phone: '+919800007701' })).toBe('Customer 7701')
    expect(customerLabel(null)).toBe('Customer')
  })
})
