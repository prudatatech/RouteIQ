import { describe, expect, it } from 'vitest'
import { isPartlyDelivered, lotLine, partDeliveredStep, partDeliveredText, publicHistory, splitDestination } from './publicView'

const at = '2026-10-01T10:00:00Z'

describe('publicHistory', () => {
  it('drops repeats, custody states and an old failed attempt', () => {
    const events = ['created', 'created', 'in_transit', 'on_hold', 'exception', 'partially_delivered'].map(status => ({ status, at }))
    expect(publicHistory(events, 'partially_delivered').map(e => e.status)).toEqual(['created', 'in_transit', 'partially_delivered'])
  })
  it('keeps the failed attempt while it is the current state', () => {
    const events = ['in_transit', 'exception'].map(status => ({ status, at }))
    expect(publicHistory(events, 'exception').map(e => e.status)).toEqual(['in_transit', 'exception'])
  })
  it('handles no history', () => {
    expect(publicHistory(null, 'created')).toEqual([])
  })
})

describe('lotLine', () => {
  it('says each lot in words', () => {
    expect(lotLine({ tracking_id: 'RTX-1-A', label: 'A', status: 'delivered', pieces_total: 50, pieces_delivered: 50 })).toBe('Lot A delivered')
    expect(lotLine({ tracking_id: 'RTX-1-B', label: 'B', status: 'in_transit', pieces_total: 25, pieces_delivered: 23 })).toBe('Lot B: 23 of 25 pieces delivered')
    expect(lotLine({ tracking_id: 'RTX-1-C', label: 'C', status: 'in_transit', pieces_total: 25, pieces_delivered: 0 })).toBe('Lot C on its way')
    expect(lotLine({ tracking_id: 'RTX-1-D', label: null, status: 'created' })).toBe('RTX-1-D not yet picked up')
  })
})

describe('isPartlyDelivered', () => {
  it('matches only the partly delivered status', () => {
    expect(isPartlyDelivered('partially_delivered')).toBe(true)
    expect(isPartlyDelivered('delivered')).toBe(false)
  })
})

describe('splitDestination', () => {
  const join = (name?: string | null, address?: string | null) => [name, address].filter(Boolean).join(', ')
  it('names one, two or several drops', () => {
    expect(splitDestination([{ name: 'Pune' }], [], join)).toBe('Pune')
    expect(splitDestination([{ name: 'Pune' }, { name: 'Surat' }], [], join)).toBe('Pune and Surat')
    expect(splitDestination([{ name: 'A' }, { name: 'B' }, { name: 'C' }], [], join)).toBe('3 delivery addresses')
  })
  it('falls back to the lots, then to a count, then to nothing', () => {
    const lots = [{ tracking_id: 'X-A', status: 'delivered', destination: { name: 'Pune' } }, { tracking_id: 'X-B', status: 'delivered' }]
    expect(splitDestination(null, lots, join)).toBe('Pune')
    expect(splitDestination(undefined, [{ tracking_id: 'X-A', status: 'created' }, { tracking_id: 'X-B', status: 'created' }], join)).toBe('2 delivery addresses')
    expect(splitDestination(null, [], join)).toBeNull()
  })
})

describe('part-delivered progress', () => {
  const lot = (status: string, label: string) => ({ tracking_id: `RTX-1-${label}`, label, status })
  it('stays on In transit while any lot is still moving, never on Delivered', () => {
    expect(partDeliveredStep([lot('delivered', 'A'), lot('partially_delivered', 'B'), lot('delivered', 'C')])).toBe(3)
    expect(partDeliveredStep([lot('delivered', 'A'), lot('in_transit', 'B')])).toBe(3)
  })
  it('is held back by a lot that has not been picked up', () => {
    expect(partDeliveredStep([lot('delivered', 'A'), lot('assigned', 'B')])).toBe(1)
    expect(partDeliveredStep([lot('delivered', 'A'), lot('dispatched', 'B')])).toBe(0)
  })
  it('ignores cancelled lots', () => {
    expect(partDeliveredStep([lot('cancelled', 'A'), lot('in_transit', 'B')])).toBe(3)
  })
  it('says how many lots are delivered', () => {
    expect(partDeliveredText([lot('delivered', 'A'), lot('in_transit', 'B'), lot('delivered', 'C')])).toBe('Part delivered: 2 of 3 lots')
    expect(partDeliveredText([])).toBe('Part delivered')
  })
})
