import { describe, expect, it, vi } from 'vitest'

// homeFor and destinationFor are pure; the module only needs the Supabase client to exist
vi.mock('./supabase', () => ({ supabase: {} }))

const { homeFor, destinationFor } = await import('./account')

const vendor = { role: 'vendor', hasVendorProfile: true, tplPartnerId: null }

describe('homeFor', () => {
  it('sends a vendor with a company profile to My loads, and one without to company setup', () => {
    expect(homeFor(vendor)).toBe('/vendor/loads')
    expect(homeFor({ ...vendor, hasVendorProfile: false })).toBe('/vendor/onboarding')
  })

  it('keeps 3PL partners, staff and drivers on their own homes', () => {
    expect(homeFor({ ...vendor, tplPartnerId: 'p1' })).toBe('/3pl-portal/p1')
    expect(homeFor({ role: 'admin', hasVendorProfile: false, tplPartnerId: null })).toBe('/today')
    expect(homeFor({ role: 'driver', hasVendorProfile: false, tplPartnerId: null })).toBe('/driver')
  })
})

describe('destinationFor', () => {
  it('lands a vendor on My loads unless a safe next page was asked for', () => {
    expect(destinationFor(vendor, null)).toBe('/vendor/loads')
    expect(destinationFor(vendor, '/vendor/claims?open=c1')).toBe('/vendor/claims?open=c1')
  })

  it('always sends a vendor with no company to set it up first', () => {
    expect(destinationFor({ ...vendor, hasVendorProfile: false }, '/vendor/claims')).toBe('/vendor/onboarding')
  })

  it('takes a new vendor back to the load or bid they started before signing up', () => {
    const fresh = { ...vendor, hasVendorProfile: false }
    expect(destinationFor(fresh, '/vendor/request?resume=1')).toBe('/vendor/request?resume=1')
    expect(destinationFor(fresh, '/vendor/return-trips?bid=w1&resume=1')).toBe('/vendor/return-trips?bid=w1&resume=1')
    expect(destinationFor(fresh, '/vendor/request')).toBe('/vendor/onboarding')
  })
})
