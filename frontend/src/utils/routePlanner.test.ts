import { describe, expect, it } from 'vitest'
import type { OpenLoad } from '@/services/routing'
import {
  applyOrder, describeSaving, formatArrival, googleMapsUrl, istInputToIso, isoToIstInput, loadWeightOfStops, moveItem, pickupDropWarning,
  planText, pointTimes, requestKey, routingErrorMessage, sectionMidpoint, stopsFromLoad, tagRoutes, toPlanRequest, truckProfileText,
  type PlannerInput, type PlannerStop,
} from './routePlanner'

const NO_AVOID = { tolls: false, highways: false, ferries: false, unpaved: false }
const place = (address: string, lat: number, lng: number) => ({ address, lat, lng })

const load: OpenLoad = {
  id: 'S1', kind: 'shipment', reference: 'MRX-1', weight_kg: 800,
  pickup: { delivery_point_id: null, name: 'Bhiwandi warehouse', address: 'Bhiwandi, MH', lat: 19.3, lng: 73.06 },
  drops: [
    { delivery_point_id: 'dp-1', name: 'Pune hub', address: 'Pune', lat: 18.59, lng: 73.73 },
    { delivery_point_id: 'dp-2', name: 'Nashik depot', address: null, lat: 19.99, lng: 73.78 },
  ],
}

describe('stops from a load', () => {
  it('puts the pickup first, then the drops, all tied to the load', () => {
    const stops = stopsFromLoad(load)
    expect(stops.map(s => [s.kind, s.name])).toEqual([['pickup', 'Bhiwandi warehouse'], ['drop', 'Pune hub'], ['drop', 'Nashik depot']])
    expect(stops.every(s => s.shipment_id === 'S1' && s.weight_kg === 800)).toBe(true)
    // Only a drop keeps the shipment's own delivery point
    expect(stops.map(s => s.delivery_point_id)).toEqual([null, 'dp-1', 'dp-2'])
    expect(stops[2].address).toBe('Nashik depot')
    expect(new Set(stops.map(s => s.key)).size).toBe(3)
  })

  it('can take just the pickup or just the drops', () => {
    expect(stopsFromLoad(load, 'pickup').map(s => s.kind)).toEqual(['pickup'])
    expect(stopsFromLoad(load, 'drops').map(s => s.kind)).toEqual(['drop', 'drop'])
  })

  it('counts each load\'s weight once however many stops it has', () => {
    const other = stopsFromLoad({ ...load, id: 'S2', weight_kg: 200 })
    expect(loadWeightOfStops([...stopsFromLoad(load), ...other])).toBe(1000)
    expect(loadWeightOfStops([{ key: 'k', name: 'Plain', address: 'x', lat: 1, lng: 1 }])).toBe(0)
  })
})

describe('reordering', () => {
  it('moves an item without changing the list it was given', () => {
    const list = ['a', 'b', 'c', 'd']
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(list, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(list).toEqual(['a', 'b', 'c', 'd'])
  })

  it('ignores moves that are not possible', () => {
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], -1, 0)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
  })

  it('applies the order the server returns, and refuses one that is not a permutation', () => {
    expect(applyOrder(['a', 'b', 'c'], [2, 0, 1])).toEqual(['c', 'a', 'b'])
    expect(applyOrder(['a', 'b', 'c'], [0, 0, 1])).toEqual(['a', 'b', 'c'])
    expect(applyOrder(['a', 'b', 'c'], [0, 1])).toEqual(['a', 'b', 'c'])
    expect(applyOrder(['a', 'b', 'c'], [0, 1, 3])).toEqual(['a', 'b', 'c'])
  })
})

describe('pickup before drop', () => {
  const [pickup, dropA, dropB] = stopsFromLoad(load)
  const plain: PlannerStop = { key: 'p', name: 'Plain stop', address: 'x', lat: 1, lng: 1, kind: 'stop' }

  it('has no warning when pickups come first', () => {
    expect(pickupDropWarning([pickup, plain, dropA, dropB])).toBeNull()
    expect(pickupDropWarning([plain])).toBeNull()
  })

  it('names the drop that comes first', () => {
    expect(pickupDropWarning([dropA, pickup, dropB])).toBe('Pune hub comes before its pickup (Bhiwandi warehouse).')
  })

  it('does not mix up different loads', () => {
    const [otherPickup] = stopsFromLoad({ ...load, id: 'S2' })
    expect(pickupDropWarning([dropA, otherPickup])).toBeNull()
  })
})

describe('the request for the server', () => {
  const input = (over: Partial<PlannerInput> = {}): PlannerInput => ({
    origin: place('Mumbai, Maharashtra', 19.076, 72.8777),
    destination: place('Pune, Maharashtra', 18.5204, 73.8567),
    stops: stopsFromLoad(load, 'pickup'),
    vehicleId: 'veh-1', loadKg: '2000', kerbKg: '7000', departLocal: '', avoid: NO_AVOID,
    ...over,
  })

  it('needs a start and an end', () => {
    expect(toPlanRequest(input({ origin: null }))).toBeNull()
    expect(toPlanRequest(input({ destination: null }))).toBeNull()
  })

  it('names places by their first address part and carries the stop details', () => {
    const req = toPlanRequest(input())!
    expect(req.origin).toEqual({ lat: 19.076, lng: 72.8777, name: 'Mumbai' })
    expect(req.stops[0]).toMatchObject({ name: 'Bhiwandi warehouse', kind: 'pickup', shipment_id: 'S1' })
    expect(req).toMatchObject({ vehicle_id: 'veh-1', load_kg: 2000, kerb_weight_kg: 7000, departure_at: null, avoid: NO_AVOID })
  })

  it('leaves out blank or invalid weights and a missing vehicle', () => {
    const req = toPlanRequest(input({ vehicleId: '', loadKg: '', kerbKg: '-5' }))!
    expect(req).toMatchObject({ vehicle_id: null, load_kg: null, kerb_weight_kg: null })
    expect(toPlanRequest(input({ loadKg: '0' }))!.load_kg).toBe(0)
  })

  it('reads a later departure as India time', () => {
    expect(toPlanRequest(input({ departLocal: '2026-10-01T09:00' }))!.departure_at).toBe('2026-10-01T03:30:00.000Z')
    expect(istInputToIso('not a time')).toBeNull()
    expect(istInputToIso('')).toBeNull()
    expect(isoToIstInput(Date.parse('2026-10-01T03:30:00Z'))).toBe('2026-10-01T09:00')
  })

  it('gives the same key for the same inputs and a new one when anything changes', () => {
    const a = requestKey(toPlanRequest(input({ stops: [] }))!)
    expect(requestKey(toPlanRequest(input({ stops: [] }))!)).toBe(a)
    expect(requestKey(toPlanRequest(input({ stops: [], avoid: { ...NO_AVOID, tolls: true } }))!)).not.toBe(a)
  })
})

describe('times along the trip', () => {
  it('adds each leg to the departure', () => {
    const times = pointTimes('2026-10-01T03:30:00.000Z', [{ distance_km: 90, travel_minutes: 100 }, { distance_km: 60, travel_minutes: 80 }])
    expect(times).toEqual(['2026-10-01T03:30:00.000Z', '2026-10-01T05:10:00.000Z', '2026-10-01T06:30:00.000Z'])
    expect(pointTimes('nonsense', [])).toEqual([])
  })

  it('shows the clock time, and the date too when it is another day in India', () => {
    expect(formatArrival('2026-10-01T06:30:00Z', '2026-10-01T03:30:00Z')).toBe('12:00 pm')
    expect(formatArrival('2026-10-01T20:30:00Z', '2026-10-01T03:30:00Z')).toBe('2 Oct 2026, 2:00 am')
  })
})

describe('naming routes', () => {
  it('marks the quickest Fastest and the fewest km Shortest', () => {
    expect(tagRoutes([{ travel_minutes: 180, distance_km: 150 }, { travel_minutes: 200, distance_km: 140 }, { travel_minutes: 210, distance_km: 160 }]))
      .toEqual(['Fastest', 'Shortest', 'Alternative'])
  })
  it('does not call one route both', () => {
    expect(tagRoutes([{ travel_minutes: 100, distance_km: 90 }])).toEqual(['Fastest'])
    expect(tagRoutes([])).toEqual([])
  })
})

describe('Google Maps link', () => {
  const a = { lat: 19.076, lng: 72.8777 }
  const b = { lat: 18.5204, lng: 73.8567 }

  it('lists the start, the stops in order and the end', () => {
    const { url, omitted } = googleMapsUrl(a, b, [{ lat: 19.3, lng: 73.06 }, { lat: 18.75, lng: 73.4 }], NO_AVOID)
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://www.google.com/maps/dir/')
    expect(parsed.searchParams.get('api')).toBe('1')
    expect(parsed.searchParams.get('origin')).toBe('19.076000,72.877700')
    expect(parsed.searchParams.get('destination')).toBe('18.520400,73.856700')
    expect(parsed.searchParams.get('waypoints')).toBe('19.300000,73.060000|18.750000,73.400000')
    expect(parsed.searchParams.get('travelmode')).toBe('driving')
    expect(parsed.searchParams.has('avoid')).toBe(false)
    expect(omitted).toBe(0)
  })

  it('passes what is avoided and leaves out the waypoints when there are none', () => {
    const { url } = googleMapsUrl(a, b, [], { tolls: true, highways: true, ferries: false, unpaved: true })
    const parsed = new URL(url)
    expect(parsed.searchParams.get('avoid')).toBe('tolls|highways')
    expect(parsed.searchParams.has('waypoints')).toBe(false)
  })

  it('keeps 9 stops and counts the rest', () => {
    const stops = Array.from({ length: 12 }, (_, i) => ({ lat: 19 + i / 100, lng: 73 }))
    const { url, omitted } = googleMapsUrl(a, b, stops, NO_AVOID)
    expect(new URL(url).searchParams.get('waypoints')!.split('|')).toHaveLength(9)
    expect(omitted).toBe(3)
  })
})

describe('plan text', () => {
  it('lists the places with arrival times, the totals, fuel and the link', () => {
    const text = planText({
      vehicle: 'MH01AB1234', departureIso: '2026-10-01T03:30:00.000Z',
      points: [{ name: 'Mumbai' }, { name: 'Lonavala' }, { name: 'Pune' }],
      route: { distance_km: 150.4, travel_minutes: 180, traffic_delay_minutes: 15, toll_km: 62.5, arrival_at: '2026-10-01T06:30:00.000Z', legs: [{ distance_km: 90, travel_minutes: 100 }, { distance_km: 60.4, travel_minutes: 80 }] },
      fuel: { litres: 30.1, cost: 2769.2 }, provider: 'tomtom', truckAware: true, mapsUrl: 'https://maps.example/x',
    })
    expect(text).toBe([
      'Route plan: Mumbai to Pune',
      'Vehicle: MH01AB1234',
      'Leaves: 1 Oct 2026, 9:00 am',
      '',
      '1. Mumbai (start)',
      '2. Lonavala, arrive 10:40 am',
      '3. Pune, arrive 12:00 pm (end)',
      '',
      'Total: 150.4 km, 3 h, traffic delay 15 min, tolls 62.5 km',
      'Fuel: about 30.1 L (₹2,769.20)',
      '',
      'Open in Google Maps: https://maps.example/x',
    ].join('\n'))
  })

  it('warns when truck restrictions were not considered and shows litres alone without a price', () => {
    const text = planText({
      vehicle: null, departureIso: '2026-10-01T03:30:00.000Z', points: [{ name: 'A' }, { name: 'B' }],
      route: { distance_km: 10, travel_minutes: 20, traffic_delay_minutes: 0, toll_km: null, arrival_at: '2026-10-01T03:50:00.000Z', legs: [{ distance_km: 10, travel_minutes: 20 }] },
      fuel: { litres: 2, cost: null }, provider: 'mapbox', truckAware: false, mapsUrl: 'u',
    })
    expect(text).toContain('Fuel: about 2 L\n')
    expect(text).not.toContain('Vehicle:')
    expect(text).toContain('does not consider truck restrictions')
  })
})

describe('small helpers', () => {
  it('describes a saving', () => {
    expect(describeSaving(30.4, 40)).toBe('40 min sooner and 30.4 km less')
    expect(describeSaving(0, 75)).toBe('1 h 15 min sooner')
    expect(describeSaving(-2, -5)).toBe('5 min longer and 2 km more')
    expect(describeSaving(0, 0)).toBe('no change in time or distance')
  })

  it('keeps the server\'s message, including a 503 that says routing is not set up', () => {
    const err = (status: number, detail?: string) => ({ response: { status, data: { detail } } })
    expect(routingErrorMessage(err(503, 'Route planning is not set up.'), 'x')).toBe('Route planning is not set up.')
    expect(routingErrorMessage(err(422, 'No drivable route was found.'), 'x')).toBe('No drivable route was found.')
    expect(routingErrorMessage(err(429), 'x')).toMatch(/Too many requests/)
    expect(routingErrorMessage(err(500, 'Internal server error'), 'Could not plan')).toBe('Could not plan')
    expect(routingErrorMessage({ code: 'ERR_NETWORK' }, 'x')).toMatch(/offline/)
    expect(routingErrorMessage(null, 'Could not plan')).toBe('Could not plan')
  })

  it('describes the truck limits that were used', () => {
    expect(truckProfileText({ weight_kg: 9000, length_m: 6.1, width_m: 2.44, height_m: 2.59 })).toBe('9,000 kg, 6.1 m long, 2.44 m wide, 2.59 m high')
    expect(truckProfileText({ weight_kg: null, length_m: null, width_m: null, height_m: null })).toBeNull()
    expect(truckProfileText(null)).toBeNull()
  })

  it('finds the middle of a traffic section', () => {
    expect(sectionMidpoint([[72, 19], [73, 18], [74, 17]])).toEqual({ lat: 18, lng: 73 })
    expect(sectionMidpoint([])).toBeNull()
  })
})
