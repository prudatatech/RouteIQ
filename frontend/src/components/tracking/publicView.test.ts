import { describe, expect, it } from 'vitest'
import { isPartlyDelivered, lotLine, publicHistory, splitDestination } from './publicView'

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
