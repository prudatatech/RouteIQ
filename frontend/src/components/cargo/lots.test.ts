import { describe, expect, it } from 'vitest'
import type { Lot, Pieces } from '@/services/cargo'
import {
  allocateByPieces, canSplit, defaultSplitReason, dropsBalance, evenSplit, followPieces, groupLots, gstinError, heldPieces, hubName,
  mergeCheck, partialTransferNote, phoneError, progressSegments, roundTo, splitBalance, splitReasonsFor,
} from './lots'
import { consignmentActions } from './logic'

const pieces = (total: number, over: Partial<Pieces> = {}): Pieces => ({ total, delivered: 0, damaged: 0, short: 0, returned: 0, on_board: null, ...over })

const lot = (label: string, over: Partial<Lot> = {}): Lot => ({
  shipment_id: `s-${label}`,
  manifest_id: null,
  tracking_id: `RTX-ABC123-${label}`,
  lot_label: label,
  label,
  seq: null,
  status: 'at_hub',
  current_holder: 'hub',
  vehicle: null,
  depot: { id: 'd1', name: 'Patna' },
  pieces: pieces(10),
  weight_kg: 100,
  declared_value: null,
  freight_share: null,
  drop: { name: 'Sharma Traders', address: 'Boring Road, Patna', lat: 25.61, lng: 85.12 },
  consignee: { name: 'Sharma Traders', phone: '9876543210', gstin: null },
  eway_bill_ref: null,
  eway_part_b_required: false,
  split_reason: 'multi_drop',
  open_exceptions: [],
  ...over,
})

describe('allocateByPieces', () => {
  it('shares by pieces and gives the rounding remainder to the last lot', () => {
    expect(allocateByPieces(100, [3, 3, 4])).toEqual([30, 30, 40])
    expect(allocateByPieces(10, [1, 1, 1])).toEqual([3.33, 3.33, 3.34])
    expect(allocateByPieces(1000, [1, 1, 1], 0)).toEqual([333, 333, 334])
  })
  it('always adds up to the total', () => {
    const parts = allocateByPieces(123.45, [7, 11, 13, 17])
    expect(roundTo(parts.reduce((a, b) => a + b, 0), 2)).toBe(123.45)
  })
  it('gives rows without pieces nothing, and the remainder to the last row that has pieces', () => {
    expect(allocateByPieces(10, [1, 0, 1, 0])).toEqual([5, 0, 5, 0])
    expect(allocateByPieces(10, [0, 0])).toEqual([0, 0])
  })
})

describe('followPieces', () => {
  it('keeps typed amounts and shares the rest by pieces', () => {
    const r = followPieces(100, [{ pieces: 50, override: 60 }, { pieces: 25, override: null }, { pieces: 25, override: null }])
    expect(r.amounts).toEqual([60, 20, 20])
    expect(r.balanced).toBe(true)
  })
  it('flags typed amounts over the total, beyond the ±0.5 allowance', () => {
    expect(followPieces(100, [{ pieces: 1, override: 100.4 }, { pieces: 1, override: null }]).over).toBe(false)
    expect(followPieces(100, [{ pieces: 1, override: 101 }, { pieces: 1, override: null }]).over).toBe(true)
  })
  it('is unbalanced when every row is typed and they do not add up', () => {
    const r = followPieces(100, [{ pieces: 1, override: 40 }, { pieces: 1, override: 40 }])
    expect(r.unassigned).toBe(20)
    expect(r.balanced).toBe(false)
    expect(followPieces(100, [{ pieces: 1, override: 49.8 }, { pieces: 1, override: 50 }]).balanced).toBe(true)
  })
})

describe('evenSplit', () => {
  it('splits whole pieces evenly with the remainder on the last drop', () => {
    expect(evenSplit(100, 3)).toEqual([33, 33, 34])
    expect(evenSplit(100, 4)).toEqual([25, 25, 25, 25])
    expect(evenSplit(5, 1)).toEqual([5])
    expect(evenSplit(10, 0)).toEqual([])
  })
})

describe('splitBalance', () => {
  const available = { pieces: 100, weight_kg: 500, declared_value: 100000, freight: 9000 }
  it('shows what stays here as the remainder lot, with its weight, value and freight', () => {
    const b = splitBalance(available, [{ pieces: '50', weight_kg: '' }, { pieces: '25', weight_kg: '' }])
    expect(b.allocated).toBe(75)
    expect(b.remainder).toEqual({ pieces: 25, weight_kg: 125, declared_value: 25000, freight: 2250 })
    expect(b.rows.map(r => r.weight_kg)).toEqual([250, 125])
    expect(b.lots).toBe(3)
    expect(b.balanced).toBe(true)
  })
  it('shares the rest of the weight by pieces when some weights are typed', () => {
    const b = splitBalance(available, [{ pieces: '50', weight_kg: '300' }])
    expect(b.rows[0].weight_kg).toBe(300)
    expect(b.remainder.weight_kg).toBe(200)
    expect(b.balanced).toBe(true)
  })
  it('blocks more pieces than are here', () => {
    const b = splitBalance(available, [{ pieces: '80', weight_kg: '' }, { pieces: '30', weight_kg: '' }])
    expect(b.balanced).toBe(false)
    expect(b.problems[0]).toBe('That is 10 pieces more than the 100 pieces here.')
  })
  it('blocks weights that do not add up when nothing stays', () => {
    const b = splitBalance(available, [{ pieces: '50', weight_kg: '200' }, { pieces: '50', weight_kg: '200' }])
    expect(b.balanced).toBe(false)
    expect(b.problems).toEqual(['The weights add up to 400 kg; they must come to 500 kg.'])
    expect(splitBalance(available, [{ pieces: '50', weight_kg: '250.3' }, { pieces: '50', weight_kg: '250' }]).balanced).toBe(true)
  })
  it('needs at least two lots and a whole number of pieces on every row', () => {
    expect(splitBalance(available, [{ pieces: '100', weight_kg: '' }]).problems[0]).toMatch(/at least two lots/)
    // The rest after a partial delivery can go on as one lot: the consignment keeps what it delivered
    expect(splitBalance({ ...available, accounted: 20 }, [{ pieces: '100', weight_kg: '' }]).balanced).toBe(true)
    const b = splitBalance(available, [{ pieces: '2.5', weight_kg: '-1' }])
    expect(b.rows[0].errors).toEqual({ pieces: 'Enter a whole number of 1 or more.', weight_kg: 'Enter a weight of 0 or more.' })
    expect(b.balanced).toBe(false)
  })
  it('leaves weight, value and freight empty when they are not known', () => {
    const b = splitBalance({ pieces: 10, weight_kg: null, declared_value: null, freight: null }, [{ pieces: '4', weight_kg: '' }])
    expect(b.remainder).toEqual({ pieces: 6, weight_kg: null, declared_value: null, freight: null })
    expect(b.balanced).toBe(true)
  })
})

describe('dropsBalance', () => {
  const totals = { pieces: 100, weight_kg: 1000, declared_value: 50000 }
  it('balances when the drops take every piece; weight and value follow pieces', () => {
    const b = dropsBalance(totals, [
      { pieces: '50', weight_kg: '', declared_value: '' },
      { pieces: '25', weight_kg: '', declared_value: '' },
      { pieces: '25', weight_kg: '', declared_value: '' },
    ])
    expect(b.balanced).toBe(true)
    expect(b.rows.map(r => [r.weight_kg, r.declared_value])).toEqual([[500, 25000], [250, 12500], [250, 12500]])
  })
  it('keeps a typed weight and shares the rest', () => {
    const b = dropsBalance(totals, [{ pieces: '50', weight_kg: '700', declared_value: '' }, { pieces: '50', weight_kg: '', declared_value: '' }])
    expect(b.rows.map(r => r.weight_kg)).toEqual([700, 300])
    expect(b.rows[0].weightTyped).toBe(true)
  })
  it('says how many pieces are left or over', () => {
    expect(dropsBalance(totals, [{ pieces: '50', weight_kg: '', declared_value: '' }, { pieces: '30', weight_kg: '', declared_value: '' }]).problems)
      .toEqual(['20 pieces not given to a drop yet.'])
    expect(dropsBalance(totals, [{ pieces: '60', weight_kg: '', declared_value: '' }, { pieces: '41', weight_kg: '', declared_value: '' }]).left).toBe(-1)
  })
  it('needs two drops, and typed values that add up', () => {
    expect(dropsBalance(totals, [{ pieces: '100', weight_kg: '', declared_value: '' }]).problems[0]).toMatch(/at least two drops/)
    const b = dropsBalance(totals, [{ pieces: '50', weight_kg: '', declared_value: '20000' }, { pieces: '50', weight_kg: '', declared_value: '20000' }])
    expect(b.problems).toEqual(['The drop values add up to ₹40,000; they must come to ₹50,000.'])
  })
})

describe('progressSegments', () => {
  it('draws the backend totals: delivered, then on vehicles, at hubs, with the sender, returned and short', () => {
    const segments = progressSegments({ delivered: 60, returned: 3, short: 1, by_holder: { consignor: 0, vehicle: 15, hub: 25 } })
    expect(segments.map(s => [s.key, s.value])).toEqual([['delivered', 60], ['vehicle', 15], ['hub', 25], ['returned', 3], ['short', 1]])
  })
  it('does not add "hub" to a name that already says it', () => {
    expect(hubName('Patna')).toBe('Patna hub')
    expect(hubName('Patna Hub')).toBe('Patna Hub')
    expect(hubName('Gurgaon Depot')).toBe('Gurgaon Depot')
  })
})

describe('mergeCheck', () => {
  const a = lot('A')
  const b = lot('B')
  it('allows lots at the same place for the same consignee and drop', () => {
    expect(mergeCheck([a, b], ['s-A', 's-B'])).toMatchObject({ ok: true, reason: null })
  })
  it('explains why a lot cannot join', () => {
    const c = lot('C', { current_holder: 'vehicle', depot: null, vehicle: { id: 'v1', plate_number: 'HR55AB1234' }, status: 'picked_up' })
    const d = lot('D', { consignee: { name: 'Gupta Stores', phone: '9000000000', gstin: null } })
    const e = lot('E', { drop: { name: null, address: 'Danapur', lat: 25.63, lng: 85.04 } })
    const f = lot('F', { status: 'on_hold' })
    const g = lot('G', { status: 'delivered', current_holder: 'consignee' })
    const h = lot('H', { pieces: pieces(10, { short: 2 }) })
    const check = mergeCheck([a, b, c, d, e, f, g, h], ['s-A'])
    expect(check.perLot).toEqual({
      's-A': null,
      's-B': null,
      's-C': 'It is on HR55AB1234, lot A is at Patna hub',
      's-D': 'It goes to a different consignee',
      's-E': 'It goes to a different drop',
      's-F': 'It is at a different stage from lot A',
      's-G': 'Already delivered',
      's-H': 'Finished',
    })
    expect(check.ok).toBe(false)
    expect(check.reason).toMatch(/at least two lots/)
    expect(mergeCheck([a, d], ['s-A', 's-D']).reason).toBe('Lot D can\'t be merged: it goes to a different consignee.')
  })
  it('leaves lots on one vehicle to the backend, which knows whether they moved since the split', () => {
    const onTruck = { status: 'in_transit', current_holder: 'vehicle' as const, depot: null, vehicle: { id: 'v1', plate_number: 'HR55AB1234' } }
    expect(mergeCheck([lot('A', onTruck), lot('B', onTruck)], ['s-A', 's-B']).ok).toBe(true)
  })
  it('matches consignees by name and the last 10 digits of the phone', () => {
    const b2 = lot('B', { consignee: { name: '  sharma  traders', phone: '+91 98765 43210', gstin: null } })
    expect(mergeCheck([a, b2], ['s-A', 's-B']).ok).toBe(true)
  })
})

describe('splitting a consignment', () => {
  const where = { status: 'at_hub', current_holder: 'hub' as const, pieces: pieces(100, { delivered: 20, on_board: 0 }) }
  it('splits the undelivered pieces one holder has', () => {
    expect(heldPieces(where.pieces)).toBe(80)
    expect(heldPieces(pieces(50, { on_board: 30, delivered: 20 }))).toBe(30)
    expect(canSplit(where)).toBe(true)
    expect(canSplit({ ...where, is_master: true })).toBe(false)
    expect(canSplit({ ...where, status: 'delivered' })).toBe(false)
    expect(canSplit({ ...where, pieces: pieces(1) })).toBe(false)
    // One piece left after a partial delivery can still go on as its own lot
    expect(canSplit({ status: 'partially_delivered', current_holder: 'vehicle', pieces: pieces(10, { delivered: 9, on_board: 1 }) })).toBe(true)
    // Goods without a count can't be split
    expect(canSplit({ ...where, pieces: { ...pieces(0), total: null } })).toBe(false)
  })
  it('picks the split reason from where the goods are', () => {
    expect(defaultSplitReason({ status: 'at_hub', current_holder: 'hub', pieces: pieces(10) })).toBe('hub_crossdock')
    expect(defaultSplitReason({ status: 'partially_delivered', current_holder: 'vehicle', pieces: pieces(10, { delivered: 4 }) })).toBe('partial_delivery_remainder')
    expect(defaultSplitReason({ status: 'created', current_holder: 'consignor', pieces: pieces(10) })).toBe('manual')
  })
  it('offers only the reasons the backend accepts for where the goods are', () => {
    expect(splitReasonsFor({ current_holder: 'vehicle', pieces: pieces(10) })).toEqual(['partial_transfer', 'manual'])
    expect(splitReasonsFor({ current_holder: 'hub', pieces: pieces(10, { delivered: 2 }) })).toEqual(['hub_crossdock', 'partial_delivery_remainder', 'manual'])
    expect(splitReasonsFor({ current_holder: 'consignor', pieces: pieces(10) })).toEqual(['manual'])
  })
  it('offers no custody action on a master', () => {
    const actions = consignmentActions({
      status: 'in_transit', current_holder: 'vehicle', vehicle: { id: 'v1', plate_number: 'X' }, pieces: pieces(10, { on_board: 10 }),
      open_exceptions: [], delivery_otp_required: false, rto: false, is_master: true,
    })
    expect(Object.values(actions).every(v => v === false || v === null)).toBe(true)
  })
})

describe('partialTransferNote', () => {
  it('says what moves as a new lot', () => {
    expect(partialTransferNote(30, 100)).toEqual({ partial: true, text: '30 of 100 will move as a new lot. 70 stay on this vehicle as another lot.' })
    expect(partialTransferNote(100, 100)).toEqual({ partial: false, text: 'All 100 pieces on board move together.' })
    expect(partialTransferNote(null, 1).text).toBe('All 1 piece on board move together.')
  })
})

describe('groupLots', () => {
  it('puts lots under their master in lot order, and keeps orphan lots on their own', () => {
    const rows = [
      { id: 'm', tracking_id: 'RTX-M', is_master: true },
      { id: 'b', tracking_id: 'RTX-M-B', parent_shipment_id: 'm', lot_seq: 2 },
      { id: 'x', tracking_id: 'RTX-X' },
      { id: 'a', tracking_id: 'RTX-M-A', parent_shipment_id: 'm', lot_seq: 1 },
      { id: 'o', tracking_id: 'RTX-GONE-A', parent_shipment_id: 'gone' },
    ]
    expect(groupLots(rows).map(g => [g.row.id, g.lots.map(l => l.id)])).toEqual([['m', ['a', 'b']], ['x', []], ['o', []]])
  })
})

describe('consignee fields', () => {
  it('checks phone numbers and GSTINs', () => {
    expect(phoneError('')).toBeUndefined()
    expect(phoneError('', true)).toBe('Enter the receiver’s phone number.')
    expect(phoneError('+91 98765-43210')).toBeUndefined()
    expect(phoneError('12345')).toBe('Enter a 10-digit mobile number.')
    expect(gstinError('10abcde1234f1z5')).toBeUndefined()
    expect(gstinError('10ABCDE')).toMatch(/15-character/)
    // The backend's check: two digits, then 13 letters or digits
    expect(gstinError('27AAAAA0000A1ZZ')).toBeUndefined()
    expect(gstinError('AB1234567890123')).toMatch(/15-character/)
  })
})
