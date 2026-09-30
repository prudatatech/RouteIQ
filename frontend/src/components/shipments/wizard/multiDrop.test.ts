import { describe, expect, it } from 'vitest'
import type { DraftDrop, DraftShipmentData } from '@/store/draftStore'
import { buildShipmentPayload, finalDropOf } from './payload'
import { validateStep } from './validation'

const drop = (id: string, over: Partial<DraftDrop> = {}): DraftDrop => ({
  id, name: id, address: `${id} road`, lat: 25.6, lng: 85.1, consignee_name: `Consignee ${id}`, consignee_phone: '9876543210', consignee_gstin: '',
  pieces: '', weight_kg: '', declared_value: '', ...over,
})

const draft = (over: Partial<DraftShipmentData> = {}): DraftShipmentData => ({
  tracking_id: 'RTX-TEST', originSearch: '', destSearch: '', searchTerm: '', mobilePhone: '', selectedVehicleId: '', origin_id: '',
  origin_name: 'Delhi', origin_address: 'Delhi', origin_lat: 28.6, origin_lng: 77.2,
  delivery_point_id: '', delivery_point_name: '', delivery_point_address: '', dest_lat: 0, dest_lng: 0,
  stops: [], priority: 'medium', cargo_type: 'standard', total_items: 100, total_weight_kg: 1000, length_cm: 50, width_cm: 50, height_cm: 50,
  plan_for_later: false, enable_mobile_gps: false, scheduled_date: '', scheduled_time: '', open_bidding: false, bidding_opens_at: '', bidding_closes_at: '',
  multi_drop: true,
  drops: [
    drop('near', { lat: 28.4, lng: 77.3, pieces: '50' }),
    drop('far', { lat: 25.6, lng: 85.1, pieces: '25', weight_kg: '400' }),
    drop('mid', { lat: 26.8, lng: 80.9, pieces: '25', consignee_gstin: '10abcde1234f1z5' }),
  ],
  ...over,
})

describe('multi-drop booking', () => {
  it('needs two drops, each with an address, a consignee and a phone', () => {
    expect(validateStep('route', draft({ drops: [drop('a')] })).drops).toMatch(/at least two drops/)
    const e = validateStep('route', draft({ drops: [drop('a', { lat: 0, lng: 0, consignee_name: '', consignee_phone: '12' }), drop('b')] }))
    expect(e['drop:a:place']).toMatch(/drop address/)
    expect(e['drop:a:consignee_name']).toMatch(/receives/)
    expect(e['drop:a:consignee_phone']).toMatch(/10-digit/)
    expect(e.destination).toBeUndefined()
  })
  it('blocks the cargo step until the pieces add up to the total', () => {
    const e = validateStep('cargo', draft({ drops: [drop('a', { pieces: '50' }), drop('b', { pieces: '30' })] }))
    expect(e.drops_split).toBe('20 pieces not given to a drop yet.')
    expect(validateStep('cargo', draft())).toEqual({})
  })
  it('sends drops[] with weight following pieces unless typed, and ends at the farthest drop', () => {
    const body = buildShipmentPayload(draft({ declared_value: '50000' }))
    expect(body.drops).toEqual([
      { address: 'near road', lat: 28.4, lng: 77.3, consignee_name: 'Consignee near', consignee_phone: '9876543210', pieces: 50, weight_kg: 400 },
      { address: 'far road', lat: 25.6, lng: 85.1, consignee_name: 'Consignee far', consignee_phone: '9876543210', pieces: 25, weight_kg: 400 },
      { address: 'mid road', lat: 26.8, lng: 80.9, consignee_name: 'Consignee mid', consignee_phone: '9876543210', consignee_gstin: '10ABCDE1234F1Z5', pieces: 25, weight_kg: 200 },
    ])
    expect(body.declared_value).toBe(50000)
    expect(body.stops).toEqual([])
    expect(finalDropOf(draft())?.address).toBe('far road')
    expect(body.dest_address).toBe('far road')
  })
  it('sends every drop value only when one was typed', () => {
    const body = buildShipmentPayload(draft({ declared_value: '10000', drops: [drop('a', { pieces: '60', declared_value: '7000' }), drop('b', { pieces: '40' })], total_items: 100 }))
    expect(body.drops?.map(d => d.declared_value)).toEqual([7000, 3000])
  })
  it('leaves a one-destination booking as before', () => {
    const body = buildShipmentPayload(draft({ multi_drop: false, dest_lat: 25.6, dest_lng: 85.1, delivery_point_name: 'Patna', delivery_point_address: 'Patna' }))
    expect(body.drops).toBeUndefined()
    expect(body.dest_name).toBe('Patna')
  })
})
