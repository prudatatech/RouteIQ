// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import PriceRecommendationModal from './PriceRecommendationModal'
import type { FreightEstimate } from '@/types/load'

afterEach(cleanup)
const estimate: FreightEstimate = {
  low: 2510, high: 4016, suggested: 3263, distance_km: 100.4, label: 'Actual rate confirmed after carrier assignment',
  basis: { source: 'Owner-provided reference rates', rate_key: 'ten_wheeler', truck_type: '10-Wheeler Truck', vehicle_name: 'Flatbed',
    vehicle_capacity_t: 20, weight_kg: 1000, min_per_km: 25, max_per_km: 40, midpoint_per_km: 32.5, distance_is_estimate: true, load_type: 'ptl',
    rates: [{ key: 'ten_wheeler', name: '10-Wheeler Truck', payload: '16–20 tonnes', min_per_km: 25, max_per_km: 40 }] },
}

describe('price recommendation modal', () => {
  it('explains fractional midpoint arithmetic, fallback distance and part-load limits, and closes', () => {
    window.scrollTo = vi.fn()
    render(<PriceRecommendationModal estimate={estimate} />)
    fireEvent.click(screen.getByRole('button', { name: 'View price recommendation' }))
    const dialog = screen.getByRole('dialog', { name: 'Price recommendation' })
    expect(within(dialog).getByText('Midpoint: 100.4 km × ₹32.5 = ₹3,263')).toBeTruthy()
    expect(within(dialog).getByText(/whole-vehicle reference for a part load/)).toBeTruthy()
    expect(within(dialog).getByText(/Road directions were unavailable/)).toBeTruthy()
    expect(within(dialog).getByRole('table', { name: 'Reference truck rates' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers no invented breakdown when a recommendation is unavailable', () => {
    render(<PriceRecommendationModal estimate={null} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
});
