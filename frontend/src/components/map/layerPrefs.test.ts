import { describe, expect, it } from 'vitest'
import { BASE_STYLES, BASE_STYLE_IDS } from '@/config/mapConfig'
import { DEFAULT_LAYER_PREFS, parseLayerPrefs } from './layerPrefs'

describe('saved map layer choices', () => {
  it('uses the defaults when nothing is saved or the value is unreadable', () => {
    expect(parseLayerPrefs(null)).toEqual(DEFAULT_LAYER_PREFS)
    expect(parseLayerPrefs('not json')).toEqual(DEFAULT_LAYER_PREFS)
  })

  it('shows live traffic flow unless it was turned off', () => {
    expect(DEFAULT_LAYER_PREFS.flow).toBe(true)
    expect(parseLayerPrefs(JSON.stringify({ base: 'dark' })).flow).toBe(true)
    expect(parseLayerPrefs(JSON.stringify({ flow: false })).flow).toBe(false)
    expect(parseLayerPrefs(JSON.stringify({ flow: 'no' })).flow).toBe(true)
  })

  it('keeps valid choices and ignores unknown ones', () => {
    expect(parseLayerPrefs(JSON.stringify({ base: 'satellite', traffic: false, trails: 'yes' })))
      .toEqual({ ...DEFAULT_LAYER_PREFS, base: 'satellite', traffic: false })
    expect(parseLayerPrefs(JSON.stringify({ base: 'moon' })).base).toBe('streets')
  })
})

describe('base maps', () => {
  it('offers streets, satellite, terrain and dark, none of which needs a token', () => {
    expect(BASE_STYLE_IDS).toEqual(['streets', 'satellite', 'terrain', 'dark'])
    for (const id of BASE_STYLE_IDS) {
      const style = BASE_STYLES[id].style
      expect(JSON.stringify(style)).not.toMatch(/token|access_key|apikey/i)
    }
  })
})
