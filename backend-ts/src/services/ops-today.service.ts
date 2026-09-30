/**
 * margixindia — Today: the work queues of the staff home page, counted in one call.
 *
 * Every queue is a head-only count (no rows are read), except the two that already have a
 * service with their own rules: vehicle requests and unpriced deliveries. Managers get the
 * operations queues only; finance, KYC and bid decisions are for admin and superadmin.
 */
import { supabase } from '../core/supabase';
import { startOfIndianDay, resolveIndianDateRange } from '../core/istDate';
import { OPEN_SOS_STATUSES } from './sos.service';
import { OPEN_EXCEPTION_STATUSES } from './cargo/exception.service';
import { countVehicleRequests } from './vehicle-approval.service';
import { getUnpricedDeliveries } from './finance.service';

/** Notification types a driver's refused action or a flagged stop sends to staff. */
export const DRIVER_ACTION_NOTIFICATION_TYPES = ['driver_action_rejected', 'stop_flagged'] as const;

export type TodayScope = 'all' | 'operations';

/** Vendor load statuses that wait for a vehicle: accepted, or escalated back to dispatch. */
const VENDOR_LOAD_NEEDS_VEHICLE = ['approved', 'escalated'];

async function countOf(query: PromiseLike<{ count: number | null; error: { message: string } | null }>, label: string): Promise<number> {
  const { count, error } = await query;
  if (error) throw new Error(`Failed to count ${label}: ${error.message}`);
  return count ?? 0;
}

const head = (table: string) => supabase.from(table).select('id', { count: 'exact', head: true });

/** Windows that closed with a bid waiting and no winner: the bids staff still have to decide. */
async function countBidsToDecide(nowISO: string): Promise<number> {
  const { data, error } = await supabase.from('capacity_bids').select('window_id').eq('status', 'pending');
  if (error) throw new Error(`Failed to read pending bids: ${error.message}`);
  const windowIds = [...new Set((data ?? []).map((b: { window_id: string | null }) => b.window_id).filter((id): id is string => !!id))];
  if (windowIds.length === 0) return 0;
  return countOf(
    head('capacity_windows').in('id', windowIds).is('winning_bid_id', null).neq('status', 'cancelled').lt('closes_at', nowISO),
    'bids to decide',
  );
}

async function unpricedDeliveries() {
  // The same 30 days the Finance invoices panel opens on
  const rows = await getUnpricedDeliveries(resolveIndianDateRange(undefined, undefined, 30));
  return { count: rows.length, no_price: rows.filter(r => !r.can_invoice).length };
}

export async function getTodayQueues(userId: string, scope: TodayScope) {
  const nowISO = new Date().toISOString();
  const todayISO = startOfIndianDay(0).toISOString();
  const all = scope === 'all';

  const [
    sos, problemsOpen, problemsOverdue, bookings, vendorLoads, shipmentsNeedVehicle, vendorLoadsNeedVehicle,
    tripsToSend, vehicleRequests, documents, driverActions,
    activeTrips, vehiclesOnRoad, routesToday, routesDoneToday,
    kyc, bids, unpriced,
  ] = await Promise.all([
    countOf(head('sos_alerts').in('status', [...OPEN_SOS_STATUSES]), 'open SOS alerts'),
    countOf(head('cargo_exceptions').in('status', [...OPEN_EXCEPTION_STATUSES]), 'open problems'),
    countOf(head('cargo_exceptions').in('status', [...OPEN_EXCEPTION_STATUSES]).lt('sla_due_at', nowISO), 'overdue problems'),
    countOf(head('customer_bookings').eq('status', 'requested'), 'new bookings'),
    countOf(head('vendor_shipment_requests').eq('status', 'pending'), 'new vendor loads'),
    // A split shipment is counted by its lots, never also as its master
    countOf(head('shipments').eq('status', 'created').neq('is_master', true), 'shipments needing a vehicle'),
    countOf(head('vendor_shipment_requests').in('status', VENDOR_LOAD_NEEDS_VEHICLE), 'vendor loads needing a vehicle'),
    countOf(head('routes').eq('status', 'pending'), 'trips to send'),
    countVehicleRequests(),
    countOf(head('user_documents').eq('status', 'pending').is('archived_at', null), 'documents to review'),
    countOf(head('notifications').eq('user_id', userId).eq('is_read', false).in('type', [...DRIVER_ACTION_NOTIFICATION_TYPES]), 'driver actions'),
    countOf(head('routes').eq('status', 'active'), 'active trips'),
    countOf(head('vehicles').eq('status', 'on_route'), 'vehicles on the road'),
    countOf(head('routes').gte('created_at', todayISO), 'trips today'),
    countOf(head('routes').eq('status', 'completed').gte('created_at', todayISO), 'trips completed today'),
    all ? countOf(head('vendor_profiles').eq('kyc_status', 'submitted'), 'KYC to review') : Promise.resolve(null),
    all ? countBidsToDecide(nowISO) : Promise.resolve(null),
    all ? unpricedDeliveries() : Promise.resolve(null),
  ]);

  const queues: Record<string, Record<string, number>> = {
    sos: { count: sos },
    problems: { count: problemsOpen, overdue: problemsOverdue },
    requests: { count: bookings + vendorLoads, bookings, vendor_loads: vendorLoads },
    needs_vehicle: { count: shipmentsNeedVehicle + vendorLoadsNeedVehicle, shipments: shipmentsNeedVehicle, vendor_loads: vendorLoadsNeedVehicle },
    trips_to_send: { count: tripsToSend },
    vehicle_requests: { count: vehicleRequests },
    documents: { count: documents },
    driver_actions: { count: driverActions },
  };
  if (all) {
    queues.unpriced = { count: unpriced!.count, no_price: unpriced!.no_price };
    queues.kyc = { count: kyc! };
    queues.bids = { count: bids! };
  }

  return {
    scope,
    generated_at: nowISO,
    queues,
    live: {
      active_trips: activeTrips,
      vehicles_on_road: vehiclesOnRoad,
      // Same rule as /dashboard/kpis: trips completed of trips created today; null with no trips
      on_time_rate_pct: routesToday > 0 ? Math.round((routesDoneToday / routesToday) * 1000) / 10 : null,
    },
  };
}
