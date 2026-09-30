import { describe, expect, it } from 'vitest'
import { isCountryBorderLayer } from './indiaBorders'

const boundary = (id: string, level: number) => ({
  id,
  type: 'line',
  'source-layer': 'boundary',
  filter: ['all', ['==', 'admin_level', level], ['==', 'maritime', 0]],
})

describe('isCountryBorderLayer', () => {
  it('hides the Carto country border layers', () => {
    expect(isCountryBorderLayer(boundary('boundary_country_outline', 2))).toBe(true)
    expect(isCountryBorderLayer(boundary('boundary_country_inner', 2))).toBe(true)
  })

  it('keeps state and district borders', () => {
    expect(isCountryBorderLayer(boundary('boundary_state', 4))).toBe(false)
    expect(isCountryBorderLayer(boundary('boundary_county', 6))).toBe(false)
  })

  it('hides disputed and admin level 2 lines under other names', () => {
    expect(isCountryBorderLayer({ id: 'boundary-disputed', type: 'line', 'source-layer': 'boundary' })).toBe(true)
    expect(isCountryBorderLayer({ id: 'admin-lines', type: 'line', 'source-layer': 'boundary', filter: ['<=', 'admin_level', 2] })).toBe(true)
    expect(isCountryBorderLayer({ id: 'lines', type: 'line', 'source-layer': 'boundary', filter: ['==', 'disputed', 1] })).toBe(true)
  })

  it('leaves labels, fills and roads alone', () => {
    expect(isCountryBorderLayer({ id: 'place_country_1', type: 'symbol', 'source-layer': 'place' })).toBe(false)
    expect(isCountryBorderLayer({ id: 'road_major', type: 'line', 'source-layer': 'transportation' })).toBe(false)
    expect(isCountryBorderLayer({ id: 'base-0', type: 'raster' })).toBe(false)
  })
})
