import { describe, expect, it } from 'vitest'
import { EWAY_BILL_THRESHOLD_RUPEES, EWAY_BILL_WARNING, needsEwayBill } from '@/config/compliance'
import { carrierText, historyEntries, lotCarriers, masterDestinationText, masterDrops, missingEwayBill } from './masterView'
import type { ShipmentHistoryEvent, ShipmentRow } from './types'

const lot = (label: string, over: Record<string, unknown> = {}) => ({
  id: `lot-${label}`, code: `RTX-1-${label}`, label, status: 'delivered', current_holder: 'consignee', current_vehicle_id: null,
  pieces_total: 1, consignee_name: null, plate_number: 'JH10AL0303' as string | null, driver_name: 'MUNNA', drop: `Drop ${label}` as string | null, eway_bill_ref: null as string | null, ...over,
})
const master = (lots: ReturnType<typeof lot>[], over: Partial<ShipmentRow> = {}): ShipmentRow => ({
  id: 'm', tracking_id: 'RTX-1', is_master: true, declared_value: 150000,
  lots_summary: { count: lots.length, delivered_lots: lots.length, pieces_delivered: 0, lots }, ...over,
})

describe('a split master shows its lots', () => {
  it('groups the lots by vehicle and driver', () => {
    const s = master([lot('A'), lot('B'), lot('C'), lot('D', { plate_number: 'DL01AL0010', driver_name: 'Vishal' }), lot('E', { plate_number: null })])
    expect(lotCarriers(s).map(carrierText)).toEqual(['JH10AL0303 · MUNNA (A, B, C)', 'DL01AL0010 · Vishal (D)'])
  })

  it('has no carrier when no lot has a vehicle', () => {
    expect(lotCarriers(master([lot('A', { plate_number: null })]))).toEqual([])
    expect(lotCarriers({ lots_summary: null })).toEqual([])
  })

  it('names its drops: a count and the places for several, the place for one, nothing for none', () => {
    const three = master([lot('A', { drop: 'Patna' }), lot('B', { drop: 'Ranchi' }), lot('C', { drop: 'Gaya' }), lot('D', { drop: ' patna ' })])
    expect(masterDrops(three)).toEqual(['Patna', 'Ranchi', 'Gaya'])
    expect(masterDestinationText(three)).toEqual({ headline: '3 drops', detail: 'Patna, Ranchi, Gaya' })
    expect(masterDestinationText(master([lot('A', { drop: 'Patna' })]))).toEqual({ headline: 'Patna', detail: null })
    expect(masterDestinationText(master([lot('A', { drop: null })]))).toBeNull()
  })
})

describe('e-way bill warning', () => {
  it('warns above the threshold with no number, never at or below it', () => {
    expect(needsEwayBill(EWAY_BILL_THRESHOLD_RUPEES + 1, null)).toBe(true)
    expect(needsEwayBill(EWAY_BILL_THRESHOLD_RUPEES, null)).toBe(false)
    expect(needsEwayBill(150000, '  ')).toBe(true)
    expect(needsEwayBill('150000', '1234 5678 9012')).toBe(false)
    expect(needsEwayBill(null, null)).toBe(false)
    expect(EWAY_BILL_WARNING).toBe('E-way bill needed (value over ₹50,000)')
  })

  it('treats a master as covered once every lot has a number', () => {
    expect(missingEwayBill(master([lot('A'), lot('B')]))).toBe(true)
    expect(missingEwayBill(master([lot('A', { eway_bill_ref: '111' }), lot('B')]))).toBe(true)
    expect(missingEwayBill(master([lot('A', { eway_bill_ref: '111' }), lot('B', { eway_bill_ref: '222' })]))).toBe(false)
    expect(missingEwayBill({ declared_value: 150000, eway_bill_ref: null })).toBe(true)
    expect(missingEwayBill({ declared_value: 20000, eway_bill_ref: null })).toBe(false)
  })
})

const ev = (status: string, at: string, over: Partial<ShipmentHistoryEvent> = {}): ShipmentHistoryEvent => ({ status, at, actor: null, note: null, location: null, ...over })

describe('status history', () => {
  it('shows identical entries one after another once', () => {
    const by = { id: 'u1', name: 'A', role: 'admin' }
    const entries = historyEntries([
      ev('created', '2026-09-30T13:23:00Z', { actor: by }),
      ev('created', '2026-09-30T13:23:20Z', { actor: by }),
      ev('assigned', '2026-09-30T13:24:00Z'),
      ev('created', '2026-09-30T13:50:00Z'),
    ])
    expect(entries.map(e => e.status)).toEqual(['created', 'assigned', 'created'])
  })

  it('keeps a repeat that is far apart or by someone else', () => {
    expect(historyEntries([ev('assigned', '2026-09-30T10:00:00Z'), ev('assigned', '2026-09-30T12:00:00Z')])).toHaveLength(2)
    expect(historyEntries([ev('created', '2026-09-30T10:00:00Z'), ev('created', '2026-09-30T10:00:10Z', { actor: { id: 'u2', name: null, role: null } })])).toHaveLength(2)
  })

  it('names a status worked out from the lots for what it is, and keeps a real failed delivery', () => {
    const [problem, failed] = historyEntries([
      ev('exception', '2026-09-30T13:29:00Z', { rollup: true }),
      ev('exception', '2026-09-30T15:00:00Z', { note: 'Door locked' }),
    ])
    expect(problem).toMatchObject({ label: 'Problem on a lot', note: 'A lot has an open problem' })
    expect(failed.label).toBeUndefined()
    expect(failed.note).toBe('Door locked · Delivery attempt failed')
  })
})
