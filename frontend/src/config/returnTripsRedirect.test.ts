import { describe, expect, it } from 'vitest'
import { returnTripsLink } from './returnTripsRedirect'

describe('old Bids address', () => {
  it('goes to Bids to decide, keeping ?open=', () => {
    expect(returnTripsLink('bids', '')).toBe('/return-trips?tab=bids')
    expect(returnTripsLink('bids', '?open=b1')).toBe('/return-trips?tab=bids&open=b1')
  })

  it('maps its filters: open stays the open tab, the rest are Bids to decide', () => {
    expect(returnTripsLink('bids', '?tab=open')).toBe('/return-trips')
    expect(returnTripsLink('bids', '?tab=decide')).toBe('/return-trips?tab=bids')
    expect(returnTripsLink('bids', '?tab=awarded&open=w1')).toBe('/return-trips?tab=bids&open=w1')
  })
})

describe('old Backhaul address', () => {
  it('goes to Pool loads', () => {
    expect(returnTripsLink('backhaul', '')).toBe('/return-trips?tab=pool')
  })

  it('maps each old tab to its view', () => {
    expect(returnTripsLink('backhaul', '?tab=loads')).toBe('/return-trips?tab=pool')
    expect(returnTripsLink('backhaul', '?tab=pool')).toBe('/return-trips?tab=pool&view=plan')
    expect(returnTripsLink('backhaul', '?tab=match')).toBe('/return-trips?tab=pool&view=match')
    expect(returnTripsLink('backhaul', '?tab=price')).toBe('/return-trips?tab=pool&view=price')
    expect(returnTripsLink('backhaul', '?tab=delivery')).toBe('/return-trips?tab=pool&view=delivery')
  })
})

describe('old 3PL partners address', () => {
  it('goes to the partners tab, keeping ?open= and the search', () => {
    expect(returnTripsLink('partners', '')).toBe('/return-trips?tab=partners')
    expect(returnTripsLink('partners', '?open=p1')).toBe('/return-trips?tab=partners&open=p1')
    expect(returnTripsLink('partners', '?q=acme&sort=name')).toBe('/return-trips?tab=partners&q=acme&sort=name')
  })

  it('moves its status filter to ?status=', () => {
    expect(returnTripsLink('partners', '?tab=active')).toBe('/return-trips?tab=partners&status=active')
    expect(returnTripsLink('partners', '?tab=pending')).toBe('/return-trips?tab=partners')
    expect(returnTripsLink('partners', '?tab=nonsense')).toBe('/return-trips?tab=partners')
  })
})
