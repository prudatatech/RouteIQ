import { describe, expect, it } from 'vitest'
import { vehicleLoad } from './load'

describe('vehicleLoad', () => {
  it('reads the weight on board first', () => {
    const l = vehicleLoad({ capacity_kg: 1000, current_load_kg: 400, declared_load_percentage: 90, available_capacity_kg: 100 })
    expect(l).toMatchObject({ loadKg: 400, freeKg: 600, pct: 40, barPct: 40, band: 'partial', source: 'weight', overKg: 0 })
  })

  it('falls back to what the driver declared, then to free space', () => {
    expect(vehicleLoad({ capacity_kg: 2000, declared_load_percentage: 50 })).toMatchObject({ loadKg: 1000, pct: 50, source: 'declared' })
    expect(vehicleLoad({ capacity_kg: 2000, available_capacity_kg: 500 })).toMatchObject({ loadKg: 1500, pct: 75, source: 'free_space' })
  })

  it('walks the bands from empty to overloaded', () => {
    const band = (load: number) => vehicleLoad({ capacity_kg: 1000, current_load_kg: load }).band
    expect(band(0)).toBe('empty')
    expect(band(10)).toBe('partial')
    expect(band(849)).toBe('partial')
    expect(band(850)).toBe('near_full')
    expect(band(999)).toBe('near_full')
    expect(band(1000)).toBe('full')
    expect(band(1001)).toBe('overloaded')
  })

  it('caps the bar at full but reports the overload', () => {
    expect(vehicleLoad({ capacity_kg: 1000, current_load_kg: 1200 })).toMatchObject({ pct: 120, barPct: 100, overKg: 200, freeKg: 0, band: 'overloaded' })
  })

  it('does not call a vehicle empty when it has not reported a load, or has no capacity', () => {
    expect(vehicleLoad({ capacity_kg: 1000 })).toMatchObject({ band: 'unknown', source: null })
    expect(vehicleLoad({ capacity_kg: 0, current_load_kg: 100 })).toMatchObject({ band: 'unknown', barPct: 0 })
    expect(vehicleLoad({})).toMatchObject({ band: 'unknown', capacityKg: 0 })
  })
})
