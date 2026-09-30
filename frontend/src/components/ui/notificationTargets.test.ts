import { describe, expect, it } from 'vitest'
import { notificationPath } from './notificationTargets'

const at = (type: string, data: Record<string, unknown> | null, audience: 'staff' | 'vendor') => notificationPath({ type, data }, audience)

describe('vendor notifications', () => {
  it.each([
    'request_approved', 'request_rejected', 'vehicle_assigned', 'request_escalated', 'request_assigned_partner',
    'request_completed', 'load_picked_up', 'load_in_transit',
  ])('%s opens the posted load on My shipments', type => {
    expect(at(type, { request_id: 'r1' }, 'vendor')).toBe('/vendor/shipments?open=r1')
  })

  it.each(['kyc_approved', 'kyc_rejected'])('%s opens Company & KYC', type => {
    expect(at(type, { vendor_id: 'v1' }, 'vendor')).toBe('/vendor/documents')
  })

  it.each(['bid_accepted', 'bid_lost', 'bid_rejected', 'bid_expired', 'bid_reopened'])('%s opens the bid on My shipments', type => {
    expect(at(type, { bid_id: 'b1' }, 'vendor')).toBe('/vendor/shipments?open=b1')
  })

  it.each(['cargo_exception_opened', 'cargo_transfer_completed', 'cargo_partial_delivery', 'cargo_rto_started', 'cargo_at_hub', 'cargo_claim_update'])(
    '%s opens the load on My shipments', type => {
      expect(at(type, { request_id: 'r1' }, 'vendor')).toBe('/vendor/shipments?open=r1')
    },
  )

  it('opens the corridors page for a passing truck', () => {
    expect(at('passing_route', { route_id: 'r1' }, 'vendor')).toBe('/vendor/corridor')
  })

  it('still goes to the page when the id is missing', () => {
    expect(at('request_approved', {}, 'vendor')).toBe('/vendor/shipments')
    expect(at('request_approved', null, 'vendor')).toBe('/vendor/shipments')
  })
})

describe('3PL partner notifications', () => {
  it('opens the offer on the partner dashboard', () => {
    expect(at('tpl_offer', { offer_id: 'o1', partner_id: 'p1' }, 'vendor')).toBe('/3pl-portal/p1?tab=orders&open=o1')
  })

  it.each(['tpl_offer_taken', 'tpl_offer_withdrawn'])('%s opens the orders tab', type => {
    expect(at(type, { partner_id: 'p1' }, 'vendor')).toBe('/3pl-portal/p1?tab=orders')
  })

  it('opens earnings for a payment', () => {
    expect(at('tpl_order_paid', { order_id: 'o1', partner_id: 'p1' }, 'vendor')).toBe('/3pl-portal/p1?tab=earnings')
  })

  it('has nowhere to go without the partner id', () => {
    expect(at('tpl_offer', { offer_id: 'o1' }, 'vendor')).toBeNull()
  })
})

describe('staff notifications', () => {
  it.each([
    ['sos', { alert_id: 'a1' }, '/emergency?open=a1'],
    ['vendor_request', { request_id: 'r1' }, '/vendor-requests?open=r1'],
    ['vendor_request_cancelled', { request_id: 'r1' }, '/vendor-requests?open=r1'],
    ['capacity_bid', { bid_id: 'b1' }, '/bids?open=b1'],
    ['capacity_window_closed', { window_id: 'w1' }, '/bids?open=w1'],
    ['stop_flagged', { bid_id: 'b1', window_id: 'w1' }, '/bids?open=b1'],
    ['kyc_submitted', { profile_id: 'v1' }, '/admin/kyc?open=v1'],
    ['tpl_application', { partner_id: 'p1' }, '/3pl-partners?open=p1'],
    ['tpl_order_status', { order_id: 'o1', partner_id: 'p1' }, '/3pl-partners/p1'],
    ['tpl_order_accepted', { order_id: 'o1', partner_id: 'p1' }, '/3pl-partners/p1'],
    ['tpl_offer_declined', { offer_id: 'f1', partner_id: 'p1' }, '/3pl-partners/p1'],
    ['stop_failed', { manifest_id: 'm1' }, '/shipments/m1'],
    ['route_postponed', { route_id: 'r1' }, '/routes/r1'],
    ['fleet_alert', { alert_id: 'a1' }, '/fleet?tab=alerts&open=a1'],
    ['vehicle_request', { vehicle_id: 'v1' }, '/vehicle-requests?open=v1'],
    ['document_expiring', { user_id: 'u1' }, '/admin/users/u1?tab=documents'],
    ['document_expiring', {}, '/admin/users?tab=attention'],
    ['cargo_exception_opened', { exception_id: 'x1' }, '/cargo/exceptions/x1'],
    ['cargo_exception_opened', {}, '/cargo'],
    ['cargo_exception_escalated', { exception_id: 'x1' }, '/cargo/exceptions/x1'],
    ['cargo_exception_escalated', {}, '/cargo?overdue=1'],
    ['cargo_exception_resolved', { exception_id: 'x1' }, '/cargo/exceptions/x1'],
    ['cargo_transfer_planned', { transfer_id: 't1' }, '/cargo/transfers/t1'],
    ['cargo_transfer_completed', {}, '/cargo?tab=transfers'],
    ['cargo_partial_delivery', { exception_id: 'x1', shipment_id: 's1' }, '/cargo/exceptions/x1'],
    ['cargo_rto_started', { shipment_id: 's1' }, '/shipments/s1'],
    ['cargo_at_hub', { depot_id: 'd1', shipment_id: 's1' }, '/cargo?tab=hubs&hub=d1'],
    ['cargo_at_hub', { manifest_id: 'm1' }, '/shipments/m1'],
    ['cargo_delivery_otp', { shipment_id: 's1' }, '/shipments/s1'],
    ['cargo_claim_update', { claim_id: 'c1' }, '/cargo?tab=claims&open=c1'],
    ['driver_action_rejected', { route_id: 'r1' }, '/routes/r1'],
    ['driver_action_rejected', { shipment_id: 's1' }, '/shipments/s1'],
  ])('%s goes to %s', (type, data, path) => {
    expect(at(type, data, 'staff')).toBe(path)
  })

  it('does not send a staff type to a vendor page or the other way round', () => {
    expect(at('capacity_bid', { bid_id: 'b1' }, 'vendor')).toBeNull()
    expect(at('bid_accepted', { bid_id: 'b1' }, 'staff')).toBeNull()
  })

  it('leaves a notification with no page alone', () => {
    expect(at('something_new', { x: 1 }, 'staff')).toBeNull()
  })
})
