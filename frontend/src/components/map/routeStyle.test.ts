import { describe, expect, it } from 'vitest'
import tokens from '@/theme/tokens.json'
import { ROUTE_PALETTES } from '@/config/mapConfig'
import { ROUTE_CASING_LAYER_ID, routeCasingLayer, routeLineLayer } from './layers'
import { congestionLineLayer } from './congestion'

const c = tokens.color

/** The style parts of a layer description (LayerProps is a union, so `paint` and `layout` are not on every member). */
const styleOf = (layer: unknown) => layer as { paint?: Record<string, unknown>; layout?: Record<string, unknown> }

/** Relative luminance of a #RRGGBB colour, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

describe('route colours', () => {
  it('come from the theme tokens, light casing on the light maps and dark casing on the dark ones', () => {
    expect(ROUTE_PALETTES.streets.casing).toBe(c.surface)
    expect(ROUTE_PALETTES.terrain.casing).toBe(c.surface)
    expect(ROUTE_PALETTES.dark.casing).toBe(c.text)
    expect(ROUTE_PALETTES.satellite.casing).toBe(c.text)
    const tokenValues = new Set(Object.values(c))
    for (const palette of Object.values(ROUTE_PALETTES)) {
      for (const colour of Object.values(palette)) expect(tokenValues.has(colour)).toBe(true)
    }
  })

  it('never draw the route or its alternatives near-white', () => {
    for (const palette of Object.values(ROUTE_PALETTES)) {
      expect(luminance(palette.line)).toBeLessThan(0.7)
      expect(luminance(palette.alternative)).toBeLessThan(0.45)
      expect(luminance(palette.planned)).toBeLessThan(0.45)
    }
  })

  it('keep the traffic colours and give unknown stretches a colour that is not a traffic level', () => {
    const colours = styleOf(congestionLineLayer(ROUTE_PALETTES.dark)).paint!['line-color'] as unknown[]
    expect(colours[colours.length - 1]).toBe(ROUTE_PALETTES.dark.unknown)
    expect(colours).toContain('#F59E0B')
    expect(ROUTE_PALETTES.dark.unknown).not.toBe('#F59E0B')
  })
})

describe('route layer order', () => {
  it('always describes the casing and the line, so their order never changes; only visibility does', () => {
    const palette = ROUTE_PALETTES.streets
    expect(routeCasingLayer(palette, true).id).toBe(ROUTE_CASING_LAYER_ID)
    expect(styleOf(routeCasingLayer(palette, false)).layout).toMatchObject({ visibility: 'none' })
    expect(styleOf(routeLineLayer(false, palette, true)).layout).toMatchObject({ visibility: 'visible' })
    expect(styleOf(routeLineLayer(false, palette, false)).layout).toMatchObject({ visibility: 'none' })
    // A dashed plan uses the planned colour, a road uses the route colour
    expect(styleOf(routeLineLayer(true, palette)).paint).toMatchObject({ 'line-color': palette.planned })
    expect(styleOf(routeLineLayer(false, palette)).paint).toMatchObject({ 'line-color': palette.line })
  })
})
