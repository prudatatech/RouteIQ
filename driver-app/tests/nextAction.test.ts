import test from 'node:test';
import assert from 'node:assert/strict';
import { getNextAction, restOfStops, type NextActionInput, type StopLot } from '../src/utils/nextAction';
import { resolveNotification, stopIdFor } from '../src/utils/notificationTarget';
import type { DriverRoute, MyRouteResponse, RouteStop } from '../src/types/route';
import type { OnBoardItem } from '../src/services/cargo';
import type { VehicleTransfer } from '../src/hooks/useCargo';

const stop = (n: number, over: Partial<RouteStop> = {}): RouteStop => ({
  id: `s${n}`,
  sequence: n,
  status: 'pending',
  delivery_point: { name: `Place ${n}`, address: `Addr ${n}`, latitude: 19 + n * 0.1, longitude: 73 },
  ...over,
});

const route = (stops: RouteStop[], status = 'active'): MyRouteResponse => ({
  active: true,
  route: { id: 'r1', status, stops } as DriverRoute,
});

const item = (over: Partial<OnBoardItem> = {}): OnBoardItem => ({
  ref: { shipment_id: 'sh1' },
  code: 'RTX-AAA111',
  status: 'in_transit',
  pieces: 10,
  weightKg: null,
  condition: null,
  sealNumber: null,
  stopId: null,
  stopName: null,
  otpRequired: null,
  exceptions: [],
  lot: { label: null, masterCode: null, consigneeName: null, consigneePhone: null },
  ...over,
});

const transfer = (over: Record<string, unknown> = {}, direction: 'in' | 'out' = 'out'): VehicleTransfer => ({
  direction,
  transfer: {
    id: 't1',
    code: 'TR-1',
    status: 'planned',
    fromVehicleId: 'v1',
    toVehicleId: 'v2',
    toDepotId: null,
    fromPlate: 'MH12AA0001',
    toPlate: 'MH12BB0002',
    depotName: null,
    meet: null,
    meetAddress: 'Toll plaza',
    plannedAt: null,
    note: null,
    exceptionCode: null,
    items: [],
    ...over,
  } as VehicleTransfer['transfer'],
});

const base = (over: Partial<NextActionInput> = {}): NextActionInput => ({
  routeData: null,
  noVehicle: false,
  assignment: null,
  isTracking: true,
  currentLoc: null,
  onBoard: [],
  transfers: [],
  openSos: false,
  dispatchIssues: [],
  upcoming: [],
  pickupWaiting: 0,
  lotsAt: (): StopLot[] => [],
  ...over,
});

const kind = (over: Partial<NextActionInput>) => getNextAction(base(over)).kind;

test('an open SOS beats everything', () => {
  assert.equal(kind({ openSos: true, assignment: { kind: 'route' }, routeData: route([stop(1)]) }), 'sos_open');
});

test('documents that block dispatch come next', () => {
  assert.equal(kind({ dispatchIssues: ['licence_expired'], assignment: { kind: 'route' } }), 'dispatch_blocked');
});

test('goods on hold for a problem take over, and a transfer does not outrank them', () => {
  assert.equal(kind({ onBoard: [item({ status: 'on_hold' })], transfers: [transfer()] }), 'cargo_on_hold');
});

test('no vehicle', () => {
  assert.equal(kind({ noVehicle: true }), 'no_vehicle');
});

test('a new trip or an inserted stop waits for a yes before anything else', () => {
  assert.equal(kind({ assignment: { kind: 'route', stops: 4 }, routeData: route([stop(1)], 'pending') }), 'accept_trip');
  assert.equal(kind({ assignment: { kind: 'stop', stopName: 'Depot' }, transfers: [transfer()] }), 'accept_trip');
});

test('transfers: receive when running, hand over to a truck, drop at a hub', () => {
  assert.equal(kind({ transfers: [transfer({ status: 'in_progress' }, 'in')] }), 'receive_goods');
  assert.equal(kind({ transfers: [transfer({}, 'in')] }), 'idle', 'a planned inbound transfer is not actionable yet');
  assert.equal(kind({ transfers: [transfer()] }), 'hand_over');
  assert.equal(kind({ transfers: [transfer({ toVehicleId: null, toDepotId: 'd1', depotName: 'Bhiwandi hub' })] }), 'drop_at_hub');
});

test('the earliest planned transfer is first', () => {
  const a = transfer({ id: 'a', code: 'TR-A', plannedAt: '2026-09-30T12:00:00Z' });
  const b = transfer({ id: 'b', code: 'TR-B', plannedAt: '2026-09-30T09:00:00Z' });
  const action = getNextAction(base({ transfers: [a, b] }));
  assert.equal(action.kind === 'hand_over' && action.transfer.transfer.id, 'b');
});

test('scanned parcels wait for pickup details', () => {
  const action = getNextAction(base({ routeData: route([stop(1, { parcel: { kind: 'manifest', code: 'CM-1', purpose: 'pickup' } })]), pickupWaiting: 2 }));
  assert.equal(action.kind, 'record_pickup');
  assert.equal(action.kind === 'record_pickup' && action.scanned, 2);
});

test('at a pickup: record it, with the pieces and the consignor', () => {
  const pickup = stop(1, { delivery_point: { name: 'Sharma Traders', latitude: 19, longitude: 73 }, parcel: { kind: 'manifest', code: 'CM-1', purpose: 'pickup' } });
  const action = getNextAction(base({ routeData: route([pickup]), currentLoc: { lat: 19, lng: 73 }, lotsAt: () => [{ code: 'CM-1', pieces: 12, label: null, consigneeName: null }] }));
  assert.equal(action.kind, 'record_pickup');
  if (action.kind === 'record_pickup') {
    assert.equal(action.pieces, 12);
    assert.equal(action.from, 'Sharma Traders');
  }
});

test('on the way to a pickup: go to pickup', () => {
  const pickup = stop(1, { parcel: { kind: 'manifest', code: 'CM-1', purpose: 'pickup' } });
  const action = getNextAction(base({ routeData: route([pickup]), currentLoc: { lat: 10, lng: 70 } }));
  assert.equal(action.kind === 'go_to_stop' && action.pickup, true);
});

test('picked up and not departed', () => {
  assert.equal(kind({ onBoard: [item({ status: 'picked_up' })], routeData: route([stop(1)], 'pending') }), 'depart');
});

test('a pending trip is started; then tracking; then the stops', () => {
  assert.equal(kind({ routeData: route([stop(1), stop(2)], 'pending') }), 'start_trip');
  assert.equal(kind({ routeData: route([stop(1)]), isTracking: false }), 'enable_tracking');
  const go = getNextAction(base({ routeData: route([stop(1, { status: 'completed' }), stop(2), stop(3), stop(4)]), currentLoc: { lat: 10, lng: 70 } }));
  assert.equal(go.kind, 'go_to_stop');
  if (go.kind === 'go_to_stop') {
    assert.equal(go.stop.id, 's2');
    assert.equal(go.index, 2);
    assert.equal(go.total, 4);
  }
});

test('within 200 m of a drop: deliver the lots there', () => {
  const lots: StopLot[] = [{ code: 'RTX-AAA111-B', pieces: 5, label: 'B', consigneeName: 'Asha Stores' }];
  const action = getNextAction(base({ routeData: route([stop(1)]), currentLoc: { lat: 19.1, lng: 73 }, lotsAt: () => lots }));
  assert.equal(action.kind, 'deliver');
  assert.deepEqual(action.kind === 'deliver' && action.lots, lots);
});

test('a drop whose goods were never picked up asks for the pickup first, not the delivery', () => {
  const s = stop(1, { parcel: { kind: 'shipment', code: 'RTX-NEW111', status: 'assigned', purpose: 'delivery' } });
  const at = { routeData: route([s]), currentLoc: { lat: 19.1, lng: 73 } };
  assert.equal(kind({ ...at }), 'pickup_first');
  // on board, or picked up on this phone (even if still queued): delivery is offered
  assert.equal(kind({ ...at, onBoard: [item({ code: 'rtx-new111', status: 'in_transit' })] }), 'deliver');
  assert.equal(kind({ ...at, pickedUpCodes: new Set(['RTX-NEW111']) }), 'deliver');
  // a stop with no status never blocks
  assert.equal(kind({ routeData: route([stop(1, { parcel: { kind: 'shipment', code: 'RTX-X' } })]), currentLoc: { lat: 19.1, lng: 73 } }), 'deliver');
});

test('a returnable consignment that is not on board is a return pickup, but only once the on-board list is known', () => {
  const s = stop(1, { parcel: { kind: 'shipment', code: 'RTX-RET111', status: 'at_hub', purpose: 'delivery' } });
  assert.equal(kind({ routeData: route([s]), currentLoc: { lat: 10, lng: 70 } }), 'return_pickup');
  assert.equal(kind({ routeData: route([s]), currentLoc: { lat: 10, lng: 70 }, onBoard: null }), 'go_to_stop');
  assert.equal(kind({ routeData: route([s]), currentLoc: { lat: 10, lng: 70 }, onBoard: [item({ code: 'RTX-RET111' })] }), 'go_to_stop');
});

test('a finished trip: hub drop if goods remain, else done with the trips waiting', () => {
  const done = route([stop(1, { status: 'completed' })]);
  assert.equal(kind({ routeData: done, onBoard: [item()] }), 'hub_drop');
  const waiting = [{ id: 'r2', stops: 3, first_stop: 'Pune', created_at: null }];
  const action = getNextAction(base({ routeData: done, upcoming: waiting }));
  assert.equal(action.kind, 'trip_done');
  assert.deepEqual(action.kind === 'trip_done' && action.upcoming, waiting);
});

test('nothing assigned', () => {
  assert.equal(kind({ routeData: { active: false, message: 'No active route assigned' } }), 'idle');
  assert.equal(kind({ routeData: null }), 'idle');
});

test('a trip with no stops yet', () => {
  assert.equal(kind({ routeData: route([]) }), 'no_stops');
});

test('a stop done out of order: the card moves to the next pending stop and the count follows', () => {
  const r = route([stop(1), stop(2, { status: 'completed' }), stop(3)]);
  const first = getNextAction(base({ routeData: r, currentLoc: { lat: 10, lng: 70 } }));
  assert.equal(first.kind === 'go_to_stop' && first.stop.id, 's1');
  assert.equal(first.kind === 'go_to_stop' && first.index, 2);
  const after = route([stop(1, { status: 'completed' }), stop(2, { status: 'completed' }), stop(3)]);
  const next = getNextAction(base({ routeData: after, currentLoc: { lat: 10, lng: 70 } }));
  assert.equal(next.kind === 'go_to_stop' && next.stop.id, 's3');
});

test('restOfStops leaves out the next stop and finished ones', () => {
  const r = route([stop(1, { status: 'completed' }), stop(2), stop(3), stop(4)]).route;
  assert.deepEqual(restOfStops(r).map((s) => s.id), ['s3', 's4']);
});

test('notification types resolve to their place', () => {
  const at = (type: string, data: Record<string, unknown> = {}) => resolveNotification({ type, data });
  assert.deepEqual(at('route_assigned', { route_id: 'r1' }), { kind: 'trip', routeId: 'r1' });
  assert.deepEqual(at('route_activated', { route_id: 'r2' }), { kind: 'trip', routeId: 'r2' });
  assert.equal(at('route_cancelled', { route_id: 'r1' }).kind, 'cancelled');
  assert.deepEqual(at('cargo_assigned', { request_id: 'q1' }), { kind: 'load', requestId: 'q1', shipmentId: null });
  assert.deepEqual(at('cargo_transfer_planned', { transfer_id: 't1' }), { kind: 'transfer', transferId: 't1' });
  assert.equal(at('cargo_transfer_planned', { transfer_id: 't1', cancelled: true }).kind, 'cancelled');
  assert.equal(at('cargo_exception_opened', { code: 'EXC-1' }).kind, 'cargo');
  assert.equal(at('cargo_transfer_completed').kind, 'home');
  assert.deepEqual(at('document_rejected', { doc_id: 'd1', doc_type: 'driving_licence' }), { kind: 'documents', docId: 'd1', docType: 'driving_licence', event: 'rejected' });
  assert.equal(at('document_expiring', { doc_id: 'd2' }).kind, 'documents');
  assert.equal(at('document_verified', { doc_id: 'd3' }).kind, 'documents');
  assert.deepEqual(at('vehicle_approval', { vehicle_id: 'v1', decision: 'approved' }), { kind: 'vehicle', vehicleId: 'v1', decision: 'approved' });
  assert.equal(at('payout_sent', { link: '/wallet' }).kind, 'wallet');
  assert.deepEqual(at('delivery_rated', { code: 'RTX-1', rating: '5', comment: 'Quick' }), { kind: 'rating', code: 'RTX-1', rating: 5, comment: 'Quick' });
  assert.equal(at('dispatch_message', { route_id: 'r1' }).kind, 'messages');
  assert.deepEqual(at('driver_action_rejected', { route_id: 'r1', shipment_id: 's1' }), { kind: 'stop', routeId: 'r1', shipmentId: 's1', manifestId: null });
  assert.equal(at('something_new').kind, 'home');
});

test('a push carries its data as JSON text', () => {
  assert.deepEqual(resolveNotification({ type: 'route_assigned', data: '{"route_id":"r9"}' }), { kind: 'trip', routeId: 'r9' });
  assert.deepEqual(resolveNotification({ type: 'route_assigned', data: '{oops' }), { kind: 'trip', routeId: null });
});

test('the stop a rejection is about', () => {
  const stops = [
    { id: 'm1_pickup', status: 'completed' },
    { id: 'm1_drop', status: 'pending' },
    { id: 's9', status: 'pending' },
  ];
  assert.equal(stopIdFor({ manifestId: 'm1', shipmentId: null }, stops, []), 'm1_drop');
  assert.equal(stopIdFor({ manifestId: null, shipmentId: 'sh1' }, stops, [{ shipmentId: 'sh1', stopId: 's9' }]), 's9');
  assert.equal(stopIdFor({ manifestId: null, shipmentId: null }, stops, []), null);
});
