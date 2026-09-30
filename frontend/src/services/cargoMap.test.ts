/**
 * The mapping from the backend's cargo answers to the web's shapes. The fixtures copy what
 * backend-ts answers (see backend-ts/test/cargo-web-contract.test.ts for the same shapes).
 */
import { describe, expect, it } from 'vitest'
import {
  labelOf, listOf, mapCaseTimeline, mapClaim, mapClaimSummary, mapCustodyEvent, mapException, mapExceptionDetail, mapHub, mapHubInventoryRow,
  mapOnBoard, mapRelief, mapTransfer, mapWhere,
} from './cargoMap'

const S1 = '51000000-0000-4000-8000-000000000001'
const M1 = 'aa110000-0000-4000-8000-000000000001'

describe('listOf', () => {
  it('reads a bare array, the named key, or items', () => {
    expect(listOf([1, 2], 'events')).toEqual([1, 2])
    expect(listOf({ events: [1] }, 'events')).toEqual([1])
    expect(listOf({ depot: {}, items: [3] }, 'rows')).toEqual([3])
    expect(listOf(null, 'x')).toEqual([])
  })
})

describe('labelOf', () => {
  it('flattens { ref, code } into ids and the tracking id', () => {
    expect(labelOf({ ref: { shipment_id: S1 }, code: 'RTX-0001', status: 'on_hold' }))
      .toEqual({ shipment_id: S1, manifest_id: null, tracking_id: 'RTX-0001', status: 'on_hold' })
    expect(labelOf({ ref: { manifest_id: M1 }, code: 'CM-AA110000' })).toMatchObject({ manifest_id: M1, tracking_id: 'CM-AA110000' })
  })
  it('uses a claim\'s consignment_code, and never takes the claim\'s own code for the goods', () => {
    expect(labelOf({ shipment_id: S1, code: 'CLM-ABC123', consignment_code: 'RTX-0001' }).tracking_id).toBe('RTX-0001')
    expect(labelOf({ shipment_id: S1, code: 'CLM-ABC123' }).tracking_id).toBeNull()
    expect(labelOf({ code: 'CLM-ABC123' }).tracking_id).toBeNull()
  })
})

describe('mapWhere', () => {
  it('keeps the ref, adds the code as tracking id, and reads the attempts and OTP flags', () => {
    const w = mapWhere({
      ref: { shipment_id: S1 }, code: 'RTX-0001', status: 'in_transit', current_holder: 'vehicle',
      vehicle: { id: 'v1', plate_number: 'MH12AB0001', driver_name: null, lat: 18.6, lng: 73.8, last_seen_at: null },
      depot: null, pieces: { total: 10, delivered: 0, damaged: 0, short: 0, returned: 0, on_board: 10 },
      seal_number: 'SEAL-1', open_exceptions: [{ id: 'x1', code: 'EXC-1', type: 'damage', severity: 'low', status: 'open', sla_due_at: null }],
      delivery_attempts: 1, max_delivery_attempts: 3, delivery_otp_required: true, rto: false, on_hold_reason: null,
    })
    expect(w.ref).toEqual({ shipment_id: S1, tracking_id: 'RTX-0001' })
    expect(w).toMatchObject({ code: 'RTX-0001', max_delivery_attempts: 3, delivery_otp_required: true, vehicle: { plate_number: 'MH12AB0001', lat: 18.6 } })
    expect(w.open_exceptions[0]).toMatchObject({ id: 'x1', code: 'EXC-1' })
  })
  it('treats an unknown on-board count as null, not zero', () => {
    const w = mapWhere({ ref: { manifest_id: M1 }, code: 'CM-AA110000', status: 'in_transit', current_holder: 'vehicle', pieces: { total: null, delivered: 0, damaged: 0, short: 0, returned: 0, on_board: null } })
    expect(w.ref).toEqual({ manifest_id: M1, tracking_id: 'CM-AA110000' })
    expect(w.pieces.on_board).toBeNull()
    expect(w.delivery_otp_required).toBe(false)
  })
})

describe('mapCustodyEvent', () => {
  it('flattens the embedded vehicles, depots, driver and recorder', () => {
    const e = mapCustodyEvent({
      id: 'e1', kind: 'handover_in', summary: 'Moved to a relief truck, 10 pieces', recorded_at: '2026-09-30T10:00:00Z',
      from_holder: 'vehicle', to_holder: 'vehicle',
      from_vehicle: { id: 'v1', plate_number: 'MH12AB0001' }, to_vehicle: { id: 'v2', plate_number: 'MH12AB0002' },
      from_depot: null, to_depot: null, pieces: 10, condition: 'good', receiver_name: null, otp_verified: null,
      photo_urls: ['https://signed/1'], signature_url: null, lat: 18.6, lng: 73.8,
      notes: 'Counted in', seal_number: null, seal_ok: null, weight_kg: 1000, exception_id: 'x1', transfer_id: 't1',
      driver: { id: 'd2', name: 'Sunil Driver' }, recorded_by: { id: 'd2', name: 'Sunil Driver', role: 'driver' }, recorded_role: 'driver',
    })
    expect(e).toMatchObject({
      from_vehicle_id: 'v1', from_vehicle_plate: 'MH12AB0001', to_vehicle_plate: 'MH12AB0002',
      recorded_by: 'd2', recorded_by_name: 'Sunil Driver', recorded_role: 'driver', driver_name: 'Sunil Driver',
      photo_urls: ['https://signed/1'], summary: 'Moved to a relief truck, 10 pieces', transfer_id: 't1',
    })
  })
  it('reads the redacted view (no recorder, no notes) and depot names', () => {
    const e = mapCustodyEvent({ id: 'e2', kind: 'hub_in', recorded_at: 'x', to_holder: 'hub', to_depot: { id: 'd1', name: 'Chakan' }, photo_urls: [], signature_url: null })
    expect(e).toMatchObject({ to_depot_id: 'd1', to_depot_name: 'Chakan', recorded_by: null, recorded_by_name: null, notes: null })
  })
})

const listed = {
  id: 'x1', code: 'EXC-ABC123', type: 'vehicle_breakdown', severity: 'high', status: 'investigating', source: 'sos',
  sos_alert_id: 'sos-1', maintenance_job_id: null, vehicle_id: 'v1', route_id: null, lat: 18.6, lng: 73.8, description: 'Engine',
  owner_id: 'u1', sla_due_at: '2026-09-30T14:00:00Z', escalation_count: 0, last_escalated_at: null, resolution: null, resolution_note: null,
  resolved_by: null, resolved_at: null, created_by: null, created_at: '2026-09-30T10:00:00Z', updated_at: null,
  plate_number: 'MH12AB0001',
  vehicle: { id: 'v1', plate_number: 'MH12AB0001', status: 'maintenance', vehicle_type: 'truck', latitude: 18.6, longitude: 73.8, driver_name: 'Ravi' },
  owner: { id: 'u1', full_name: 'Asha Admin' },
  items: [{
    id: 'i1', ref: { shipment_id: S1 }, code: 'RTX-0001', status: 'on_hold', current_holder: 'vehicle', current_vehicle_id: 'v1', current_depot_id: null,
    pieces_held: 10, pieces_total: 10, pieces_affected: 10, weight_affected_kg: 1000, condition: null, note: null,
  }],
  sla: { due_at: '2026-09-30T14:00:00Z', overdue: false, minutes_left: 120 },
}

describe('mapException', () => {
  it('maps items from { ref, code } and keeps the vehicle and owner embeds', () => {
    const e = mapException(listed)
    expect(e.items[0]).toMatchObject({ id: 'i1', exception_id: 'x1', shipment_id: S1, tracking_id: 'RTX-0001', status: 'on_hold', pieces_total: 10, pieces_held: 10 })
    expect(e.vehicle).toMatchObject({ plate_number: 'MH12AB0001', latitude: 18.6 })
    expect(e.owner).toEqual({ id: 'u1', full_name: 'Asha Admin' })
    expect(e).not.toHaveProperty('sla')
  })
  it('builds a vehicle from the plate when only the plate is sent', () => {
    const { vehicle: _v, ...older } = listed
    expect(mapException(older).vehicle).toEqual({ id: 'v1', plate_number: 'MH12AB0001' })
  })
})

describe('mapCaseTimeline', () => {
  it('turns the case log into notes and actions, and keeps custody lines with their consignment', () => {
    const t = mapCaseTimeline([
      { at: '2026-09-30T10:00:00Z', source: 'case', kind: 'opened', text: 'Engine failure' },
      { at: '2026-09-30T10:05:00Z', source: 'case', kind: 'action', text: 'Owner set to Asha Admin', by: 'u1', by_name: 'Asha Admin', role: 'admin' },
      { at: '2026-09-30T10:06:00Z', source: 'case', kind: 'note', text: 'Mechanic on the way', by: 'u1', by_name: 'Asha Admin', role: 'admin' },
      { at: '2026-09-30T10:07:00Z', source: 'custody', kind: 'hold', text: 'On hold', ref: { shipment_id: S1 }, by: null, by_name: null, role: 'system', data: { pieces: 10, condition: null, transfer_id: null } },
      { at: '2026-09-30T09:59:00Z', source: 'sos', kind: 'sos_raised', text: 'SOS (breakdown, serious): Engine' },
    ])
    expect(t.map(e => [e.source, e.title, e.note])).toEqual([
      ['action', 'Case opened', 'Engine failure'],
      ['action', 'Owner set to Asha Admin', null],
      ['note', 'Note', 'Mechanic on the way'],
      ['custody', null, 'On hold'],
      ['sos', 'SOS raised', 'SOS (breakdown, serious): Engine'],
    ])
    expect(t[1]).toMatchObject({ actor_name: 'Asha Admin', actor_role: 'admin' })
    expect(t[3]).toMatchObject({ ref: { shipment_id: S1 }, pieces: 10 })
    expect(new Set(t.map(e => e.id)).size).toBe(5)
  })
})

describe('mapTransfer', () => {
  it('maps items and embeds, with the case', () => {
    const t = mapTransfer({
      id: 't1', code: 'TRF-1', exception_id: 'x1', from_vehicle_id: 'v1', to_vehicle_id: null, to_depot_id: 'd1', status: 'planned',
      planned_at: '2026-09-30T10:00:00Z', eway_part_b_required: false,
      from_vehicle: { id: 'v1', plate_number: 'MH12AB0001', latitude: 18.6, longitude: 73.8 }, to_vehicle: null,
      to_depot: { id: 'd1', name: 'Chakan', address: 'MIDC', latitude: 18.76, longitude: 73.86 },
      exception: { id: 'x1', code: 'EXC-1', type: 'vehicle_breakdown', status: 'action_planned' },
      items: [{ id: 'ti1', ref: { manifest_id: M1 }, code: 'CM-AA110000', status: 'on_hold', pieces_planned: 4, pieces_out: null, pieces_in: null, condition_in: null }],
    })
    expect(t.items[0]).toEqual({ id: 'ti1', transfer_id: 't1', shipment_id: null, manifest_id: M1, tracking_id: 'CM-AA110000', status: 'on_hold', pieces_planned: 4, pieces_out: null, pieces_in: null, condition_in: null })
    expect(t.to_depot).toMatchObject({ name: 'Chakan', latitude: 18.76 })
    expect(t.exception).toMatchObject({ code: 'EXC-1' })
    expect(t.to_vehicle).toBeNull()
  })
})

describe('claims', () => {
  it('names the goods by consignment_code and keeps every document path', () => {
    const c = mapClaim({ id: 'c1', code: 'CLM-1', shipment_id: S1, manifest_id: null, consignment_code: 'RTX-0001', status: 'filed', document_paths: ['claims/c1/a.pdf', 'claims/c1/b.pdf'], documents: [{ path: 'claims/c1/a.pdf', url: 'https://signed/a' }] })
    expect(c).toMatchObject({ code: 'CLM-1', shipment_id: S1, tracking_id: 'RTX-0001', document_paths: ['claims/c1/a.pdf', 'claims/c1/b.pdf'] })
    expect(c.documents).toEqual([{ path: 'claims/c1/a.pdf', url: 'https://signed/a' }])
  })
  it('reads the short claims on a case page without taking the claim code for the goods', () => {
    const c = mapClaimSummary({ id: 'c1', code: 'CLM-1', claim_type: 'damage', status: 'draft', claimed_amount: 100, shipment_id: S1, manifest_id: null })
    expect(c).toMatchObject({ code: 'CLM-1', shipment_id: S1, status: 'draft', tracking_id: null })
  })
})

describe('mapExceptionDetail', () => {
  it('maps the timeline, full transfers and short claims', () => {
    const d = mapExceptionDetail({
      ...listed,
      timeline: [{ at: 'x', source: 'case', kind: 'note', text: 'Hi' }],
      transfers: [{ id: 't1', code: 'TRF-1', status: 'planned', items: [], to_vehicle: { id: 'v2', plate_number: 'MH12AB0002' } }],
      claims: [{ id: 'c1', code: 'CLM-1', claim_type: 'damage', status: 'draft', shipment_id: S1 }],
      sos_alert: null, maintenance_job: null,
    })
    expect(d.timeline[0].source).toBe('note')
    expect(d.transfers[0].to_vehicle?.plate_number).toBe('MH12AB0002')
    expect(d.claims[0].code).toBe('CLM-1')
    expect(d.owner?.full_name).toBe('Asha Admin')
  })
})

describe('relief, hubs and on board', () => {
  it('keeps whether a relief vehicle fits and carries the cargo type', () => {
    const r = mapRelief({ vehicle: { id: 'v5', plate_number: 'MH12AB0005', latitude: 18.6, longitude: 73.8, cargo_types: ['general'] }, distance_km: 0.2, free_kg: 100, fits: false, cargo_match: true, eta_minutes: 1 })
    expect(r).toMatchObject({ fits: false, cargo_match: true, free_kg: 100, vehicle: { plate_number: 'MH12AB0005', cargo_types: ['general'] } })
  })
  it('reads a hub with its weight and age', () => {
    expect(mapHub({ id: 'd1', name: 'Chakan', address: 'MIDC', consignments: 1, pieces: 10, weight_kg: 1000, oldest_since: 'x', oldest_age_hours: 2.5 }))
      .toMatchObject({ consignments: 1, weight_kg: 1000, oldest_age_hours: 2.5 })
  })
  it('names the next leg of a hub row by its name, with the address as the destination', () => {
    const r = mapHubInventoryRow({ ref: { shipment_id: S1 }, code: 'RTX-0001', status: 'at_hub', pieces: 10, weight_kg: 1000, since: null, age_hours: null, rto: false, next_leg: { name: 'Hinjewadi warehouse', address: 'Hinjewadi, Pune', lat: 1, lng: 2 }, open_exceptions: [] })
    expect(r).toMatchObject({ shipment_id: S1, tracking_id: 'RTX-0001', since: null, next_leg: { label: 'Hinjewadi warehouse', address: 'Hinjewadi, Pune' }, destination: 'Hinjewadi, Pune' })
  })
  it('reads { vehicle, totals, items } for the on-board view', () => {
    const b = mapOnBoard({
      vehicle: { id: 'v1', plate_number: 'MH12AB0001' }, totals: { consignments: 1, pieces: 10, weight_kg: 1000 },
      items: [{ ref: { shipment_id: S1 }, code: 'RTX-0001', status: 'in_transit', pieces_on_board: 10, pieces_total: 10, weight_kg: 1000, condition: 'good', seal_number: 'S', rto: false, on_hold_reason: null, next_stop: { stop_id: 'st1', name: 'Hinjewadi warehouse', address: 'Hinjewadi' }, open_exceptions: [] }],
    }, 'v1')
    expect(b.vehicle?.plate_number).toBe('MH12AB0001')
    expect(b.items[0]).toMatchObject({ shipment_id: S1, tracking_id: 'RTX-0001', pieces_on_board: 10, next_stop: { name: 'Hinjewadi warehouse', address: 'Hinjewadi' } })
  })
})
