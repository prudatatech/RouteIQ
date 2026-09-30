import { describe, expect, it } from 'vitest'
import { notificationPath } from './notificationTargets'

const at = (type: string, data: Record<string, unknown> | null, audience: 'staff' | 'vendor') => notificationPath({ type, data }, audience)

describe('vendor notifications', () => {
  it.each([
    'request_approved', 'request_rejected', 'vehicle_assigned', 'request_escalated', 'request_assigned_partner',
    'request_completed', 'load_picked_up', 'load_in_transit',
  ])('%s opens the posted load', type => {
    expect(at(type, { request_id: 'r1' }, 'vendor')).toBe('/vendor/loads/r1')
  })

  it.each(['kyc_approved', 'kyc_rejected'])('%s opens Company', type => {
    expect(at(type, { vendor_id: 'v1' }, 'vendor')).toBe('/vendor/company')
  })

  it.each(['bid_lost', 'bid_rejected', 'bid_expired', 'bid_reopened'])('%s opens the bid on Return trips', type => {
    expect(at(type, { bid_id: 'b1' }, 'vendor')).toBe('/vendor/return-trips?bid=b1')
  })

  it('opens the load a won bid created, else the bid', () => {
    expect(at('bid_accepted', { bid_id: 'b1', shipment_id: 's1', window_id: 'w1' }, 'vendor')).toBe('/vendor/loads/s1')
    expect(at('bid_accepted', { bid_id: 'b1' }, 'vendor')).toBe('/vendor/return-trips?bid=b1')
    expect(at('bid_lost', {}, 'vendor')).toBe('/vendor/return-trips')
  })

  it.each(['cargo_exception_opened', 'cargo_exception_resolved', 'cargo_transfer_completed', 'cargo_partial_delivery', 'cargo_rto_started', 'cargo_at_hub'])(
    '%s opens the load', type => {
      expect(at(type, { request_id: 'r1', manifest_id: 'm1' }, 'vendor')).toBe('/vendor/loads/r1')
    },
  )

  it('opens the claim that changed, else its load, else the claims list', () => {
    expect(at('cargo_claim_update', { request_id: 'r1', manifest_id: 'm1', claim_id: 'c1', code: 'CLM-1' }, 'vendor')).toBe('/vendor/claims?open=c1')
    expect(at('cargo_claim_update', { request_id: 'r1' }, 'vendor')).toBe('/vendor/loads/r1')
    expect(at('cargo_claim_update', {}, 'vendor')).toBe('/vendor/claims')
  })

  it('opens the return trip window that opened', () => {
    expect(at('return_trip_opened', { window_id: 'w1', closes_at: '2026-10-01T10:00:00Z' }, 'vendor')).toBe('/vendor/return-trips?window=w1')
    expect(at('return_trip_opened', {}, 'vendor')).toBe('/vendor/return-trips')
    expect(at('passing_route', { route_id: 'r1' }, 'vendor')).toBe('/vendor/return-trips')
  })

  it('asks the vendor to add the pickup location on Company', () => {
    expect(at('vendor_profile_incomplete', { bid_id: 'b1', window_id: 'w1', missing: 'location' }, 'vendor')).toBe('/vendor/company')
  })

  it.each(['invoice_issued', 'invoice_paid'])('%s opens that invoice on Invoices & proofs', type => {
    expect(at(type, { invoice_id: 'i1', request_id: 'r1' }, 'vendor')).toBe('/vendor/invoices?open=i1')
    expect(at(type, {}, 'vendor')).toBe('/vendor/invoices')
  })

  it('still goes to My loads when the id is missing', () => {
    expect(at('request_approved', {}, 'vendor')).toBe('/vendor/loads')
    expect(at('request_approved', null, 'vendor')).toBe('/vendor/loads')
  })

  it('has a page for every vendor type the backend sends', () => {
    for (const type of [
      'request_approved', 'request_rejected', 'vehicle_assigned', 'request_escalated', 'request_assigned_partner', 'request_completed', 'load_picked_up', 'load_in_transit',
      'bid_accepted', 'bid_lost', 'bid_rejected', 'bid_expired', 'bid_reopened', 'kyc_approved', 'kyc_rejected', 'return_trip_opened', 'passing_route',
      'vendor_profile_incomplete', 'invoice_issued', 'invoice_paid', 'cargo_exception_opened', 'cargo_exception_resolved', 'cargo_transfer_completed',
      'cargo_partial_delivery', 'cargo_rto_started', 'cargo_at_hub', 'cargo_claim_update',
    ]) expect(at(type, {}, 'vendor'), type).toMatch(/^\/vendor\//)
  })
})

describe('3PL partner notifications', () => {
  it('opens the offer on Orders, the portal home', () => {
    expect(at('tpl_offer', { offer_id: 'o1', partner_id: 'p1' }, 'vendor')).toBe('/3pl-portal/p1?open=o1')
  })

  it.each(['tpl_offer_taken', 'tpl_offer_withdrawn'])('%s opens Orders', type => {
    expect(at(type, { partner_id: 'p1' }, 'vendor')).toBe('/3pl-portal/p1')
  })

  it('opens Earnings for a payment', () => {
    expect(at('tpl_order_paid', { order_id: 'o1', partner_id: 'p1' }, 'vendor')).toBe('/3pl-portal/p1/earnings')
  })

  it.each(['tpl_approved', 'tpl_paused', 'tpl_resumed', 'tpl_rejected'])('%s opens the portal, where the account status is shown', type => {
    expect(at(type, { partner_id: 'p1' }, 'vendor')).toBe('/3pl-portal/p1')
  })

  it('has nowhere to go without the partner id', () => {
    expect(at('tpl_offer', { offer_id: 'o1' }, 'vendor')).toBeNull()
  })
})

describe('staff notifications', () => {
  it.each([
    ['sos', { alert_id: 'a1' }, '/emergency?open=a1'],
    ['vendor_request', { request_id: 'r1' }, '/requests?open=r1&source=vendor'],
    ['vendor_request', {}, '/requests?source=vendor'],
    ['vendor_request_cancelled', { request_id: 'r1' }, '/requests?open=r1&source=vendor'],
    ['customer_booking', { booking_id: 'b1' }, '/requests?open=b1&source=customer'],
    ['capacity_bid', { bid_id: 'b1' }, '/return-trips?tab=bids&open=b1'],
    ['capacity_bid', {}, '/return-trips?tab=bids'],
    ['capacity_window_closed', { window_id: 'w1' }, '/return-trips?tab=bids&open=w1'],
    ['stop_flagged', { bid_id: 'b1', window_id: 'w1' }, '/return-trips?tab=bids&open=b1'],
    ['stop_flagged', { window_id: 'w1' }, '/return-trips?tab=bids&open=w1'],
    ['kyc_submitted', { profile_id: 'v1' }, '/admin/kyc?open=v1'],
    ['tpl_application', { partner_id: 'p1' }, '/return-trips?tab=partners&open=p1'],
    ['tpl_application', {}, '/return-trips?tab=partners'],
    ['tpl_update', { partner_id: 'p1' }, '/return-trips?tab=partners&open=p1'],
    ['tpl_order_status', { order_id: 'o1', partner_id: 'p1' }, '/3pl-partners/p1'],
    ['tpl_order_status', {}, '/return-trips?tab=partners'],
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
    ['cargo_rto_started', { manifest_id: 'm1' }, '/shipments/m1'],
    ['cargo_at_hub', { depot_id: 'd1', shipment_id: 's1' }, '/cargo?tab=hubs&hub=d1'],
    ['cargo_at_hub', { manifest_id: 'm1' }, '/shipments/m1'],
    ['cargo_delivery_otp', { shipment_id: 's1' }, '/shipments/s1'],
    ['cargo_claim_update', { claim_id: 'c1' }, '/cargo?tab=claims&open=c1'],
    ['driver_action_rejected', { route_id: 'r1' }, '/routes/r1'],
    ['driver_action_rejected', { shipment_id: 's1' }, '/shipments/s1'],
    ['driver_signed_up', { user_id: 'u1' }, '/admin/users/u1'],
    ['driver_signed_up', {}, '/admin/users'],
    ['driver_needs_vehicle', { user_id: 'u1' }, '/admin/users/u1'],
    ['document_uploaded', { user_id: 'u1', doc_id: 'd1' }, '/admin/users/u1?tab=documents'],
    ['bank_details_changed', { user_id: 'u1' }, '/admin/users/u1?tab=bank'],
    ['stop_prompts_released', { user_id: 'u1' }, '/admin/users/u1'],
    ['people_status', { count: 1, user_ids: ['u1'] }, '/admin/users/u1'],
    ['people_status', { count: 2, user_ids: ['u1', 'u2'] }, '/admin/users'],
    ['delivery_rated', { shipment_id: 's1', rating: 4 }, '/shipments/s1'],
    ['delivery_rated', {}, '/shipments'],
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

describe('driver pay notifications', () => {
  it('a missing pay rate opens Driver pay', () => {
    expect(at('driver_pay_rate_missing', { vehicle_type: 'truck' }, 'staff')).toBe('/money/driver-pay')
  })
})
