import { describe, expect, it } from 'vitest'
import type { Lot, Pieces } from '@/services/cargo'
import {
  allocateByPieces, canSplit, defaultSplitReason, dropsBalance, evenSplit, followPieces, groupLots, gstinError, heldPieces, hubName,
  lotRollup, mergeCheck, partialTransferNote, phoneError, rollupStatus, roundTo, splitBalance,
} from './lots'
import { consignmentActions } from './logic'

const pieces = (total: number, over: Partial<Pieces> = {}): Pieces => ({ total, delivered: 0, damaged: 0, short: 0, returned: 0, on_board: null, ...over })

const lot = (label: string, over: Partial<Lot> = {}): Lot => ({
  shipment_id: `s-${label}`,
  manifest_id: null,
  tracking_id: `RTX-ABC123-${label}`,
  lot_label: label,
  label,
  status: 'at_hub',
  current_holder: 'hub',
  vehicle: null,
  depot: { id: 'd1', name: 'Patna' },
  pieces: pieces(10),
  weight_kg: null,
  declared_value: null,
  freight_share: null,
  drop: { name: 'Sharma Traders', address: 'Boring Road, Patna', lat: 25.61, lng: 85.12 },
  consignee: { name: 'Sharma Traders', phone: '9876543210', gstin: null },
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

describe('lotRollup', () => {
  it('words the master progress: delivered, then where the rest is, biggest first', () => {
    const r = lotRollup([
      lot('A', { status: 'delivered', current_holder: 'consignee', depot: null, pieces: pieces(60, { delivered: 60 }) }),
      lot('B', { pieces: pieces(25) }),
      lot('C', { status: 'in_transit', current_holder: 'vehicle', depot: null, vehicle: { id: 'v1', plate_number: 'HR55AB1234' }, pieces: pieces(15, { on_board: 15 }) }),
    ])
    expect(r.headline).toBe('60 of 100 delivered · 25 at Patna hub · 15 on HR55AB1234')
    expect(r.parts.map(p => p.value)).toEqual([25, 15])
  })
  it('adds up lots in the same place and lists returned and short pieces last', () => {
    const r = lotRollup([
      lot('A', { status: 'created', current_holder: 'consignor', depot: null, pieces: pieces(10) }),
      lot('B', { status: 'created', current_holder: 'consignor', depot: null, pieces: pieces(5) }),
      lot('C', { status: 'returned', current_holder: 'consignor', depot: null, pieces: pieces(4, { returned: 3, short: 1 }) }),
    ])
    expect(r.headline).toBe('0 of 19 delivered · 15 with the sender · 3 returned · 1 short')
  })
  it('counts a delivered lot with no counts as delivered in full', () => {
    expect(lotRollup([lot('A', { status: 'delivered', current_holder: 'consignee', pieces: pieces(8) })]).delivered).toBe(8)
    expect(lotRollup([]).headline).toBe('No pieces counted yet')
  })
  it('does not add "hub" to a name that already says it', () => {
    expect(hubName('Patna')).toBe('Patna hub')
    expect(hubName('Patna Hub')).toBe('Patna Hub')
    expect(hubName('Gurgaon Depot')).toBe('Gurgaon Depot')
  })
})

describe('rollupStatus', () => {
  it('follows the contract rules', () => {
    expect(rollupStatus(['delivered', 'delivered'])).toBe('delivered')
    expect(rollupStatus(['returned', 'returned'])).toBe('returned')
    expect(rollupStatus(['delivered', 'in_transit'])).toBe('in_transit')
    expect(rollupStatus(['in_transit', 'on_hold'])).toBe('on_hold')
    expect(rollupStatus(['exception', 'on_hold'])).toBe('exception')
    expect(rollupStatus(['delivered', 'returned'])).toBe('partially_delivered')
    expect(rollupStatus(['delivered', 'lost'])).toBe('partially_delivered')
    expect(rollupStatus(['delivered', 'created'])).toBe('partially_delivered')
    expect(rollupStatus(['created', 'assigned'])).toBe('assigned')
    expect(rollupStatus(['created'])).toBe('created')
    expect(rollupStatus([])).toBeNull()
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
    const f = lot('F', { status: 'in_transit', current_holder: 'vehicle', depot: null, vehicle: { id: 'v1', plate_number: 'HR55AB1234' } })
    const g = lot('G', { status: 'delivered', current_holder: 'consignee' })
    const check = mergeCheck([a, b, c, d, e, f, g], ['s-A'])
    expect(check.perLot).toEqual({
      's-A': null,
      's-B': null,
      's-C': 'It is on HR55AB1234, lot A is at Patna hub',
      's-D': 'It goes to a different consignee',
      's-E': 'It goes to a different drop',
      's-F': 'Already on its way',
      's-G': 'Already delivered',
    })
    expect(check.ok).toBe(false)
    expect(check.reason).toMatch(/at least two lots/)
    expect(mergeCheck([a, d], ['s-A', 's-D']).reason).toBe('Lot D can\'t be merged: it goes to a different consignee.')
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
  })
  it('picks the split reason from where the goods are', () => {
    expect(defaultSplitReason({ status: 'at_hub', current_holder: 'hub' })).toBe('hub_crossdock')
    expect(defaultSplitReason({ status: 'partially_delivered', current_holder: 'vehicle' })).toBe('partial_delivery_remainder')
    expect(defaultSplitReason({ status: 'created', current_holder: 'consignor' })).toBe('manual')
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
  })
})
