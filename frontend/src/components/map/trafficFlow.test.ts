import { describe, expect, it } from 'vitest'
import { FLOW_LAYER_ID, TRAFFIC_LEGEND, flowInsertBeforeId, flowTilesUrl } from './trafficFlow'

const layer = (id: string, type = 'line') => ({ id, type })

// The shape of the Carto base map: a water label below the roads, place and road names at the end
const carto = [
  layer('background', 'background'), layer('water', 'fill'), layer('waterway_label', 'symbol'),
  layer('road_pri_fill'), layer('bridge_mot_fill'), layer('building', 'fill'),
  layer('boundary_country_inner'), layer('watername_ocean', 'symbol'), layer('place_city', 'symbol'), layer('roadname_major', 'symbol'),
]

describe('where the traffic flow layer goes', () => {
  it('sits over the roads and under the labels', () => {
    expect(flowInsertBeforeId(carto)).toBe('watername_ocean')
  })

  it('stays under India\'s borders, geofences, trails and the route line', () => {
    const withOverlays = [...carto, layer('india-pov-borders-casing'), layer('india-pov-borders-line'), layer('mapview-route-line')]
    expect(flowInsertBeforeId(withOverlays)).toBe('watername_ocean')
    // a base map with no labels (satellite): just below the first overlay
    const satellite = [layer('base-0', 'raster'), layer('india-pov-borders-line'), layer('mapview-route-congestion')]
    expect(flowInsertBeforeId(satellite)).toBe('india-pov-borders-line')
  })

  it('goes on top when the base map has no labels and nothing of ours is drawn yet', () => {
    expect(flowInsertBeforeId([layer('base-0', 'raster')])).toBeUndefined()
    expect(flowInsertBeforeId([])).toBeUndefined()
  })

  it('does not count itself, so it can be looked up again after it was added', () => {
    const again = [...carto.slice(0, 3), layer(FLOW_LAYER_ID, 'raster'), ...carto.slice(3)]
    expect(flowInsertBeforeId(again)).toBe('watername_ocean')
  })
})

describe('flow tile url', () => {
  it('is absolute, keeps the {z}/{x}/{y} placeholders and carries the token', () => {
    const url = flowTilesUrl('https://api.example.com/api/v1', 'https://app.example.com', 'abc.def')
    expect(url).toBe('https://api.example.com/api/v1/traffic/tiles/flow/{z}/{x}/{y}.png?t=abc.def')
  })

  it('resolves a relative api base against the page', () => {
    expect(flowTilesUrl('/api/v1', 'https://app.example.com', 't')).toBe('https://app.example.com/api/v1/traffic/tiles/flow/{z}/{x}/{y}.png?t=t')
  })
})

describe('traffic legend', () => {
  it('goes from free flow to stopped', () => {
    expect(TRAFFIC_LEGEND.map((l) => l.label)).toEqual(['Free flow', 'Slow', 'Queuing', 'Stopped'])
    expect(new Set(TRAFFIC_LEGEND.map((l) => l.color)).size).toBe(4)
  })
})
