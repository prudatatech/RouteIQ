/**
 * margixindia — Driver pay.
 *
 * A driver is paid a fixed amount per trip plus a rate per km, set per vehicle type (decision of
 * 30 Sep 2026, docs/workflow-blueprint.html). The customer's invoice has nothing to do with it.
 *
 *  - `driver_pay_rates`   the rate card; a new rate takes over from its effective date, older rows stay
 *  - `driver_pay_entries` one per finished trip, made by the backend when a route is completed or a
 *                         vendor load is delivered: earned -> approved -> paid, or void
 *  - `driver_payouts`     a payment made outside the app (cash, bank or UPI) covering approved entries
 *
 * Money is only handled for admin and superadmin; a driver reads their own pay through
 * `getDriverPay`. Writing an entry never blocks or undoes the trip it belongs to (`recordTripPaySafe`).
 */
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { indianDateKey, indianDayStart } from '../core/istDate';
import { auditService, AuditActor } from './audit.service';
import { notificationService } from './notification.service';
import { selectIn } from './finance.service';
import { getPayoutAccount } from './people-bank.service';
import { cleanPathKm, haversineKm, roundKm } from './odometer';

export const PAY_VEHICLE_TYPES = ['truck', 'van', 'bike', 'car'] as const;
export const PAY_STATUSES = ['earned', 'approved', 'paid', 'void'] as const;
export const PAYOUT_METHODS = ['cash', 'bank', 'upi'] as const;
export type PayStatus = (typeof PAY_STATUSES)[number];
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];
export type KmSource = 'gps' | 'planned' | 'estimated' | 'none';

export interface PayRate {
  id: string;
  vehicle_type: string;
  per_trip_amount: number;
  per_km_amount: number;
  effective_from: string;
  active: boolean;
}

export interface PayAdjustment { amount: number; reason: string; by: string; at: string }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const money = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
/** A trip needs this many GPS points inside its window before the driven distance is trusted over the plan. */
const MIN_GPS_POINTS = 3;
const MAX_GPS_POINTS = 5000;
/** A staff notice about a missing rate is not repeated for the same vehicle type within this many hours. */
const MISSING_RATE_NOTICE_HOURS = 24 * 90;
const LIST_LIMIT = 500;

// ── Pure rules ──────────────────────────────────────────────

/** The rate in force on a trip date: the active rate of that vehicle type with the latest start on or before it. */
export function pickRate<T extends { vehicle_type: string; effective_from: string; active?: boolean }>(
  rates: T[], vehicleType: string | null | undefined, tripDate: string,
): T | null {
  if (!vehicleType) return null;
  const inForce = rates
    .filter(r => r.active !== false && r.vehicle_type === vehicleType && r.effective_from <= tripDate)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  return inForce[0] ?? null;
}

/** Sum of the signed corrections staff added. */
export function adjustmentTotal(adjustments: unknown): number {
  return money((Array.isArray(adjustments) ? adjustments : []).reduce((s: number, a: any) => s + num(a?.amount), 0));
}

/** What the driver is owed for a trip: the fixed amount, the km rate times the distance, and the corrections. */
export function payAmount(perTrip: number, perKm: number, km: number, adjustments: unknown = []): number {
  return money(perTrip + perKm * km + adjustmentTotal(adjustments));
}

// ── Rates ───────────────────────────────────────────────────

const toRate = (r: any): PayRate => ({
  id: r.id, vehicle_type: r.vehicle_type, per_trip_amount: num(r.per_trip_amount), per_km_amount: num(r.per_km_amount),
  effective_from: String(r.effective_from).slice(0, 10), active: r.active !== false,
});

async function loadRates(vehicleType?: string): Promise<PayRate[]> {
  let q = supabase.from('driver_pay_rates').select('id, vehicle_type, per_trip_amount, per_km_amount, effective_from, active').eq('active', true);
  if (vehicleType) q = q.eq('vehicle_type', vehicleType);
  const { data, error } = await q;
  if (error) throw new Error(`Failed to read pay rates: ${error.message}`);
  return (data ?? []).map(toRate);
}

const validType = (v: unknown): string => {
  if (typeof v !== 'string' || !(PAY_VEHICLE_TYPES as readonly string[]).includes(v)) throw new HttpError(400, `vehicle_type must be one of ${PAY_VEHICLE_TYPES.join(', ')}`);
  return v;
};
const validAmount = (v: unknown, name: string): number => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 10_000_000) throw new HttpError(400, `${name} must be an amount of 0 or more`);
  return money(n);
};
const validDate = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(v))) throw new HttpError(400, `${name} must be a date (YYYY-MM-DD)`);
  return v;
};

/** Every rate, newest start first, with the day each one is replaced (`superseded_on`), for the rates editor. */
export async function listRates(includeWithdrawn = false) {
  let q = supabase.from('driver_pay_rates').select('id, vehicle_type, per_trip_amount, per_km_amount, effective_from, active, created_by, created_at');
  if (!includeWithdrawn) q = q.eq('active', true);
  const { data, error } = await q.order('effective_from', { ascending: false });
  if (error) throw new Error(`Failed to read pay rates: ${error.message}`);
  const rows = (data ?? []).map((r: any) => ({ ...toRate(r), created_by: r.created_by ?? null, created_at: r.created_at ?? null }));
  const today = indianDateKey(new Date());
  return rows.map(r => {
    const next = rows.filter(o => o.active && o.vehicle_type === r.vehicle_type && o.effective_from > r.effective_from)
      .sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0];
    const superseded_on = r.active ? next?.effective_from ?? null : null;
    const state = !r.active ? 'withdrawn'
      : r.effective_from > today ? 'upcoming'
      : superseded_on && superseded_on <= today ? 'superseded' : 'current';
    return { ...r, superseded_on, state };
  });
}

export async function createRate(actor: AuditActor, body: Record<string, any>) {
  const vehicle_type = validType(body.vehicle_type);
  const per_trip_amount = validAmount(body.per_trip_amount ?? 0, 'per_trip_amount');
  const per_km_amount = validAmount(body.per_km_amount ?? 0, 'per_km_amount');
  const effective_from = validDate(body.effective_from ?? indianDateKey(new Date()), 'effective_from');
  if (effective_from > indianDateKey(new Date(Date.now() + 366 * 86_400_000))) throw new HttpError(400, 'effective_from is too far ahead');

  // A rate already starting that day is replaced: it is withdrawn, not deleted
  const { error: retireErr } = await supabase.from('driver_pay_rates').update({ active: false })
    .eq('vehicle_type', vehicle_type).eq('effective_from', effective_from).eq('active', true);
  if (retireErr) throw new Error(`Failed to replace the rate: ${retireErr.message}`);

  const { data, error } = await supabase.from('driver_pay_rates')
    .insert({ vehicle_type, per_trip_amount, per_km_amount, effective_from, active: true, created_by: actor.user_id })
    .select('id, vehicle_type, per_trip_amount, per_km_amount, effective_from, active').single();
  if (error) throw new Error(`Failed to save the rate: ${error.message}`);
  await auditService.record('staff-console', actor, 'driver_pay.rate_set', { vehicle_type, per_trip_amount, per_km_amount, effective_from }, `Rate ${data.id}`);
  const repriced = await repriceMissingRateEntries(vehicle_type);
  return { rate: toRate(data), repriced_entries: repriced };
}

export async function updateRate(actor: AuditActor, id: string, body: Record<string, any>) {
  const { data: rate, error } = await supabase.from('driver_pay_rates').select('id, vehicle_type, per_trip_amount, per_km_amount, effective_from, active').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to read the rate: ${error.message}`);
  if (!rate || !rate.active) throw new HttpError(404, 'Rate not found');
  const patch: Record<string, unknown> = {};
  if (body.per_trip_amount !== undefined) patch.per_trip_amount = validAmount(body.per_trip_amount, 'per_trip_amount');
  if (body.per_km_amount !== undefined) patch.per_km_amount = validAmount(body.per_km_amount, 'per_km_amount');
  if (body.effective_from !== undefined) {
    patch.effective_from = validDate(body.effective_from, 'effective_from');
    const { data: clash } = await supabase.from('driver_pay_rates').select('id').eq('vehicle_type', rate.vehicle_type).eq('effective_from', patch.effective_from as string).eq('active', true).neq('id', id);
    if ((clash ?? []).length > 0) throw new HttpError(409, 'Another rate for this vehicle type already starts that day');
  }
  if (Object.keys(patch).length === 0) throw new HttpError(400, 'Nothing to change');
  const { data: updated, error: updErr } = await supabase.from('driver_pay_rates').update(patch).eq('id', id).select('id, vehicle_type, per_trip_amount, per_km_amount, effective_from, active').single();
  if (updErr) throw new Error(`Failed to save the rate: ${updErr.message}`);
  await auditService.record('staff-console', actor, 'driver_pay.rate_changed', { rate_id: id, vehicle_type: rate.vehicle_type, ...patch });
  const repriced = await repriceMissingRateEntries(rate.vehicle_type);
  return { rate: toRate(updated), repriced_entries: repriced };
}

/** Withdraw a rate. It stays as history; trips already priced keep their amounts. */
export async function withdrawRate(actor: AuditActor, id: string) {
  const { data: rate } = await supabase.from('driver_pay_rates').select('id, vehicle_type, effective_from, active').eq('id', id).maybeSingle();
  if (!rate || !rate.active) throw new HttpError(404, 'Rate not found');
  const { error } = await supabase.from('driver_pay_rates').update({ active: false }).eq('id', id);
  if (error) throw new Error(`Failed to withdraw the rate: ${error.message}`);
  await auditService.record('staff-console', actor, 'driver_pay.rate_withdrawn', { rate_id: id, vehicle_type: rate.vehicle_type, effective_from: rate.effective_from });
  return { id, withdrawn: true };
}

/** A rate was just set: trips that finished with none (amount 0, flagged) are priced now, if a rate now covers their date. */
async function repriceMissingRateEntries(vehicleType: string): Promise<number> {
  const { data, error } = await supabase.from('driver_pay_entries')
    .select('id, trip_date, km, adjustments, status').eq('vehicle_type', vehicleType).eq('rate_missing', true).eq('status', 'earned');
  if (error) throw new Error(`Failed to read entries: ${error.message}`);
  const rates = await loadRates(vehicleType);
  let count = 0;
  for (const e of data ?? []) {
    const rate = pickRate(rates, vehicleType, String(e.trip_date).slice(0, 10));
    if (!rate) continue;
    const { data: done } = await supabase.from('driver_pay_entries').update({
      rate_id: rate.id, per_trip_amount: rate.per_trip_amount, per_km_amount: rate.per_km_amount, rate_missing: false,
      amount: payAmount(rate.per_trip_amount, rate.per_km_amount, num(e.km), e.adjustments), updated_at: new Date().toISOString(),
    }).eq('id', e.id).eq('status', 'earned').select('id').maybeSingle();
    if (done) count++;
  }
  return count;
}

// ── Trip finished: make the entry ───────────────────────────

interface TripKm { km: number; source: KmSource }

/** The distance of a route: driven (GPS between start and finish), else planned, else the stops in a line. */
async function routeKm(route: any, stops: any[]): Promise<TripKm> {
  if (route.started_at && route.completed_at && route.vehicle_id) {
    const { data } = await supabase.from('gps_points').select('latitude, longitude, accuracy, recorded_at')
      .eq('vehicle_id', route.vehicle_id).gte('recorded_at', route.started_at).lte('recorded_at', route.completed_at)
      .order('recorded_at', { ascending: true }).limit(MAX_GPS_POINTS);
    const points = (data ?? [])
      .filter((p: any) => p.latitude != null && p.longitude != null && (p.accuracy == null || Number(p.accuracy) <= 100))
      .map((p: any) => ({ lat: Number(p.latitude), lng: Number(p.longitude), at: p.recorded_at as string }));
    if (points.length >= MIN_GPS_POINTS) {
      const path = cleanPathKm(null, points);
      if (path.km > 0) return { km: roundKm(path.km), source: 'gps' };
    }
  }
  if (num(route.total_distance_km) > 0) return { km: roundKm(num(route.total_distance_km)), source: 'planned' };
  const ordered = [...stops].sort((a, b) => num(a.sequence) - num(b.sequence)).map(s => s.delivery_points).filter((p: any) => p?.latitude != null && p?.longitude != null);
  let km = 0;
  for (let i = 0; i + 1 < ordered.length; i++) km += haversineKm({ lat: Number(ordered[i].latitude), lng: Number(ordered[i].longitude) }, { lat: Number(ordered[i + 1].latitude), lng: Number(ordered[i + 1].longitude) });
  return km > 0 ? { km: roundKm(km), source: 'estimated' } : { km: 0, source: 'none' };
}

// A vendor load is paid per vehicle journey, not per lot: lots of one master that travel together on
// one vehicle make one entry (the per-trip amount once, the journey km once), keyed master + vehicle.
// A standalone load (no lots) is its own master.
export type TripRef = { route_id: string; manifest_id?: never; vehicle_id?: never } | { manifest_id: string; vehicle_id?: string; route_id?: never };

const ENTRY_COLUMNS = 'id, driver_id, vehicle_id, vehicle_type, route_id, manifest_id, trip_date, km, km_source, rate_id, per_trip_amount, per_km_amount, adjustments, amount, rate_missing, status, approved_at, approved_by, void_reason, voided_at, payout_id, created_at, updated_at';

/** Lot statuses after which a lot needs its vehicle no more. */
const LOT_DONE = ['delivered', 'completed', 'returned', 'cancelled', 'lost'];
/** The ones that mean the vehicle really carried goods (a journey of only cancelled lots pays nothing). */
const LOT_CARRIED = ['delivered', 'completed', 'returned'];
/** How far from the moment of a handover a GPS ping still counts as the handover point. */
const HANDOVER_WINDOW_MS = 30 * 60_000;

interface Pt { lat: number; lng: number }
const pt = (lat: unknown, lng: unknown): Pt | null => (lat == null || lng == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) ? null : { lat: Number(lat), lng: Number(lng) });

/** Where the goods changed vehicles: the from-vehicle's GPS ping nearest the handover, else the transfer's meet point. */
async function handoverPoint(transfer: any): Promise<Pt | null> {
  if (transfer.completed_at && transfer.from_vehicle_id) {
    const at = Date.parse(transfer.completed_at);
    const { data } = await supabase.from('gps_points').select('latitude, longitude, recorded_at').eq('vehicle_id', transfer.from_vehicle_id)
      .gte('recorded_at', new Date(at - HANDOVER_WINDOW_MS).toISOString()).lte('recorded_at', new Date(at + HANDOVER_WINDOW_MS).toISOString());
    const nearest = (data ?? []).map((p: any) => ({ p, d: Math.abs(Date.parse(p.recorded_at) - at) })).filter(x => Number.isFinite(x.d)).sort((a, b) => a.d - b.d)[0];
    const found = nearest ? pt(nearest.p.latitude, nearest.p.longitude) : null;
    if (found) return found;
  }
  return pt(transfer.meet_lat, transfer.meet_lng);
}

/** GPS distance of a window on a vehicle, or null with fewer than MIN_GPS_POINTS usable pings. */
async function gpsKm(vehicleId: string, from: string, to: string): Promise<number | null> {
  const { data } = await supabase.from('gps_points').select('latitude, longitude, accuracy, recorded_at')
    .eq('vehicle_id', vehicleId).gte('recorded_at', from).lte('recorded_at', to).order('recorded_at', { ascending: true }).limit(MAX_GPS_POINTS);
  const points = (data ?? [])
    .filter((p: any) => p.latitude != null && p.longitude != null && (p.accuracy == null || Number(p.accuracy) <= 100))
    .map((p: any) => ({ lat: Number(p.latitude), lng: Number(p.longitude), at: p.recorded_at as string }));
  if (points.length < MIN_GPS_POINTS) return null;
  const km = cleanPathKm(null, points).km;
  return km > 0 ? roundKm(km) : null;
}

/** Without GPS: from the start to the farthest place the vehicle went; with no start, the legs between the drops in order. */
export function journeyEstimateKm(start: Pt | null, ends: Pt[]): TripKm {
  if (ends.length === 0) return { km: 0, source: 'none' };
  let km = 0;
  if (start) km = Math.max(...ends.map(e => haversineKm(start, e)));
  else for (let i = 0; i + 1 < ends.length; i++) km += haversineKm(ends[i], ends[i + 1]);
  return Number.isFinite(km) && km > 0 ? { km: roundKm(km), source: 'estimated' } : { km: 0, source: 'none' };
}

interface PayTarget { key: 'route_id' | 'manifest_id'; tripId: string; vehicleId: string; finishedAt: string; distance: TripKm }

/**
 * Who earns a trip on this vehicle: its driver; when the vehicle has none now (the driver was
 * unassigned after the trip), the last driver who recorded a custody step on it.
 */
async function payeeOf(vehicle: { id: string; driver_id: string | null }): Promise<string | null> {
  if (vehicle.driver_id) return vehicle.driver_id;
  const { data } = await supabase.from('cargo_custody_events').select('driver_id, recorded_at')
    .or(`from_vehicle_id.eq.${vehicle.id},to_vehicle_id.eq.${vehicle.id}`).not('driver_id', 'is', null).order('recorded_at', { ascending: false }).limit(1);
  return data?.[0]?.driver_id ?? null;
}

/** Price a finished journey and save its entry (once), and tell staff once when the type has no rate. */
async function saveEntry(t: PayTarget): Promise<{ entry: any; created: boolean } | null> {
  const { data: vehicle, error: vehicleErr } = await supabase.from('vehicles').select('id, driver_id, vehicle_type').eq('id', t.vehicleId).maybeSingle();
  if (vehicleErr) throw new Error(`Failed to read the vehicle: ${vehicleErr.message}`);
  const driverId = vehicle ? await payeeOf(vehicle) : null;
  if (!vehicle || !driverId) {
    // Nobody to pay: say so once, instead of leaving the trip out of driver pay without a word
    if (vehicle) {
      try {
        await notificationService.notifyStaffOnce(
          'A finished trip has no driver to pay',
          'A trip finished on a vehicle that has no driver assigned, so it has no driver pay entry. Assign the driver on the vehicle, then run the driver pay backfill.',
          'driver_pay_no_driver', { vehicle_id: vehicle.id, link: '/money/driver-pay' }, 'vehicle_id', 24,
        );
      } catch (e) {
        console.error('[driver-pay] Could not tell staff about the trip with no driver:', e);
      }
    }
    return null;
  }

  const tripDate = indianDateKey(new Date(t.finishedAt));
  const rate = pickRate(await loadRates(vehicle.vehicle_type), vehicle.vehicle_type, tripDate);
  const perTrip = rate?.per_trip_amount ?? 0;
  const perKm = rate?.per_km_amount ?? 0;
  const row = {
    driver_id: driverId,
    vehicle_id: vehicle.id,
    vehicle_type: vehicle.vehicle_type ?? null,
    route_id: t.key === 'route_id' ? t.tripId : null,
    manifest_id: t.key === 'manifest_id' ? t.tripId : null,
    trip_date: tripDate,
    km: t.distance.km,
    km_source: t.distance.source,
    rate_id: rate?.id ?? null,
    per_trip_amount: perTrip,
    per_km_amount: perKm,
    adjustments: [],
    amount: payAmount(perTrip, perKm, t.distance.km),
    rate_missing: !rate,
    status: 'earned' as PayStatus,
  };
  const { data: created, error: insertErr } = await supabase.from('driver_pay_entries').insert(row).select(ENTRY_COLUMNS).single();
  if (insertErr) {
    // Two completions racing: the other one won, and its entry is the answer
    if ((insertErr as any).code === '23505') {
      const winner = await existingEntry(t.key, t.tripId, t.key === 'manifest_id' ? t.vehicleId : undefined);
      if (winner) return { entry: winner, created: false };
    }
    throw new Error(`Failed to save the trip's pay: ${insertErr.message}`);
  }

  if (!rate && vehicle.vehicle_type) {
    try {
      await notificationService.notifyStaffOnce(
        `Set a pay rate for ${vehicle.vehicle_type}`,
        `A ${vehicle.vehicle_type} trip finished with no driver pay rate set, so it is at ₹0 for now. Set the rate and it is priced automatically.`,
        'driver_pay_rate_missing', { vehicle_type: vehicle.vehicle_type, link: '/money/driver-pay' }, 'vehicle_type', MISSING_RATE_NOTICE_HOURS,
      );
    } catch (e) {
      console.error('[driver-pay] Could not tell staff about the missing rate:', e);
    }
  }
  return { entry: created, created: true };
}

async function existingEntry(key: 'route_id' | 'manifest_id', tripId: string, vehicleId?: string) {
  let q = supabase.from('driver_pay_entries').select(ENTRY_COLUMNS).eq(key, tripId);
  if (vehicleId) q = q.eq('vehicle_id', vehicleId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`Failed to read the trip's pay: ${error.message}`);
  return data;
}

/**
 * The pay of one vehicle's journey with a vendor load and its lots. Made when the last lot on that
 * vehicle is delivered, returned or cancelled (not on the first), or when the last lot leaves it
 * in a transfer. A lot moved to another vehicle in a transfer pays that vehicle's driver for their
 * own leg (from the handover point), and the first driver keeps the journey up to the handover.
 */
async function recordJourneyPay(masterId: string, vehicleId: string): Promise<{ entry: any; created: boolean } | null> {
  const existing = await existingEntry('manifest_id', masterId, vehicleId);
  if (existing) return { entry: existing, created: false };

  const { data: rows, error } = await supabase.from('cargo_manifest')
    .select('id, vehicle_id, status, is_master, parent_manifest_id, lot_seq, pickup_lat, pickup_lng, drop_lat, drop_lng, updated_at')
    .or(`id.eq.${masterId},parent_manifest_id.eq.${masterId}`);
  if (error) throw new Error(`Failed to read the load: ${error.message}`);
  const lots = (rows ?? []).filter((l: any) => !l.is_master).sort((a: any, b: any) => num(a.lot_seq) - num(b.lot_seq));
  const onVehicle = lots.filter((l: any) => l.vehicle_id === vehicleId);

  // Transfers of these lots that were completed: out of this vehicle, and into it
  const items = await selectIn<any>('cargo_transfer_items', 'manifest_id', lots.map((l: any) => l.id), 'transfer_id, manifest_id');
  const transfers = (await selectIn<any>('cargo_transfers', 'id', items.map(i => i.transfer_id), 'id, from_vehicle_id, to_vehicle_id, status, meet_lat, meet_lng, completed_at'))
    .filter(tr => tr.status === 'completed');
  const out = transfers.filter(tr => tr.from_vehicle_id === vehicleId && tr.to_vehicle_id !== vehicleId);
  const into = transfers.filter(tr => tr.to_vehicle_id === vehicleId);

  if (onVehicle.some((l: any) => !LOT_DONE.includes(String(l.status)))) return null;
  if (!onVehicle.some((l: any) => LOT_CARRIED.includes(String(l.status))) && out.length === 0) return null;

  const times = [...onVehicle.map((l: any) => l.updated_at), ...out.map(tr => tr.completed_at)].filter(Boolean) as string[];
  const finishedAt = times.sort().at(-1) ?? new Date().toISOString();

  // GPS from when the goods came aboard to when the journey ended
  const { data: events } = await supabase.from('cargo_custody_events').select('to_vehicle_id, recorded_at')
    .in('manifest_id', lots.map((l: any) => l.id)).eq('to_vehicle_id', vehicleId);
  const boarded = (events ?? []).map((e: any) => e.recorded_at as string).filter(Boolean).sort()[0];
  const gps = boarded ? await gpsKm(vehicleId, boarded, finishedAt) : null;

  let distance: TripKm;
  if (gps != null) {
    distance = { km: gps, source: 'gps' };
  } else {
    const handoversIn = await Promise.all(into.map(handoverPoint));
    const handoversOut = await Promise.all(out.map(handoverPoint));
    // A driver who took goods over starts at the handover; the first driver starts at the pickup
    const first = onVehicle.find((l: any) => pt(l.pickup_lat, l.pickup_lng)) ?? lots.find((l: any) => pt(l.pickup_lat, l.pickup_lng));
    const start = handoversIn.find(Boolean) ?? (first ? pt(first.pickup_lat, first.pickup_lng) : null);
    const ends = [
      ...onVehicle.filter((l: any) => LOT_CARRIED.includes(String(l.status))).map((l: any) => pt(l.drop_lat, l.drop_lng)),
      ...handoversOut,
    ].filter((p): p is Pt => !!p);
    distance = journeyEstimateKm(start, ends);
  }
  return saveEntry({ key: 'manifest_id', tripId: masterId, vehicleId, finishedAt, distance });
}

/**
 * Create the pay entry of a finished trip. Safe to call twice: a trip or journey is paid once, and
 * the second call returns the entry that exists. Uses the rate in force on the trip date. With no
 * rate for the vehicle type the entry is 0 and flagged `rate_missing`, and staff are told once.
 * Returns null when there is nobody to pay, or the trip is not finished (for a vendor load: while
 * a lot is still on the vehicle).
 */
export async function recordTripPay(trip: TripRef): Promise<{ entry: any; created: boolean } | null> {
  if (trip.route_id) {
    const existing = await existingEntry('route_id', trip.route_id);
    if (existing) return { entry: existing, created: false };
    const { data: route, error } = await supabase.from('routes')
      .select('id, vehicle_id, status, total_distance_km, started_at, completed_at, updated_at, route_stops(sequence, delivery_points(latitude, longitude))').eq('id', trip.route_id).maybeSingle();
    if (error) throw new Error(`Failed to read the route: ${error.message}`);
    if (!route || route.status !== 'completed' || !route.vehicle_id) return null;
    return saveEntry({
      key: 'route_id', tripId: route.id, vehicleId: route.vehicle_id, finishedAt: route.completed_at ?? route.updated_at ?? new Date().toISOString(),
      distance: await routeKm(route, (route as any).route_stops ?? []),
    });
  }

  const { data: manifest, error } = await supabase.from('cargo_manifest').select('id, vehicle_id, is_master, parent_manifest_id').eq('id', trip.manifest_id).maybeSingle();
  if (error) throw new Error(`Failed to read the load: ${error.message}`);
  // A master holds no goods of its own; its lots are what travels
  if (!manifest || manifest.is_master) return null;
  const vehicleId = trip.vehicle_id ?? manifest.vehicle_id;
  if (!vehicleId) return null;
  return recordJourneyPay(manifest.parent_manifest_id ?? manifest.id, vehicleId);
}

/** The hook the trip code calls: never throws, so a pay problem cannot stop a trip from finishing. */
export async function recordTripPaySafe(trip: TripRef): Promise<void> {
  try {
    await recordTripPay(trip);
  } catch (e) {
    console.error('[driver-pay] Could not record the trip pay:', e);
  }
}

/** A transfer took lots off a vehicle: that vehicle's journey may now be over. Never throws. */
export async function recordJourneyAfterTransferSafe(masterId: string, fromVehicleId: string): Promise<void> {
  try {
    await recordJourneyPay(masterId, fromVehicleId);
  } catch (e) {
    console.error('[driver-pay] Could not record the journey pay after a transfer:', e);
  }
}

/**
 * A transfer took customer shipments (lots) off a vehicle: when that leaves the vehicle with no
 * goods of the trip aboard, the first driver's leg is over at the handover. Pays the from-route:
 * the per-trip amount and the km up to the handover point (GPS from the route's start, else the
 * pickup to the handover). The entry is keyed on the route, so the route completing later finds
 * it and pays nothing more; doing this twice pays once. Returns null when there is nothing to pay.
 */
export async function recordShipmentLegAfterTransfer(shipmentIds: string[], transferId: string, fromVehicleId: string): Promise<{ entry: any; created: boolean } | null> {
  if (shipmentIds.length === 0) return null;
  // Goods still aboard: the route completes as usual and pays the whole trip
  const [{ data: aboard }, { data: aboardLoads }] = await Promise.all([
    supabase.from('shipments').select('id').eq('current_vehicle_id', fromVehicleId).eq('current_holder', 'vehicle')
      .not('status', 'in', '(delivered,partially_delivered,returned,lost,cancelled)').limit(1),
    supabase.from('cargo_manifest').select('id').eq('current_vehicle_id', fromVehicleId).eq('current_holder', 'vehicle')
      .not('status', 'in', '(delivered,completed,returned,cancelled,lost)').limit(1),
  ]);
  if ((aboard ?? []).length > 0 || (aboardLoads ?? []).length > 0) return null;

  const { data: points } = await supabase.from('delivery_points').select('id').in('shipment_id', shipmentIds);
  const pointIds = (points ?? []).map((d: any) => d.id);
  if (pointIds.length === 0) return null;
  const { data: stops } = await supabase.from('route_stops').select('route_id').in('delivery_point_id', pointIds);
  const routeIds = [...new Set((stops ?? []).map((r: any) => r.route_id as string))];
  if (routeIds.length === 0) return null;
  // The route the driver drove: one that was started (by then the transfer may have cancelled it, as the
  // moved goods were its last stops)
  const { data: routes } = await supabase.from('routes').select('id, vehicle_id, status, started_at, created_at')
    .in('id', routeIds).eq('vehicle_id', fromVehicleId).not('started_at', 'is', null);
  const route = (routes ?? []).sort((a: any, b: any) => String(b.started_at ?? b.created_at).localeCompare(String(a.started_at ?? a.created_at)))[0];
  if (!route) return null;

  const existing = await existingEntry('route_id', route.id);
  if (existing) return { entry: existing, created: false };

  const { data: transfer } = await supabase.from('cargo_transfers').select('id, from_vehicle_id, meet_lat, meet_lng, completed_at').eq('id', transferId).maybeSingle();
  const finishedAt = transfer?.completed_at ?? new Date().toISOString();
  const gps = route.started_at ? await gpsKm(fromVehicleId, route.started_at, finishedAt) : null;
  let distance: TripKm;
  if (gps != null) {
    distance = { km: gps, source: 'gps' };
  } else {
    const { data: origins } = await supabase.from('shipments').select('origin_lat, origin_lng').in('id', shipmentIds);
    const start = (origins ?? []).map((o: any) => pt(o.origin_lat, o.origin_lng)).find(Boolean) ?? null;
    const handover = transfer ? await handoverPoint(transfer) : null;
    distance = journeyEstimateKm(start, handover ? [handover] : []);
  }
  return saveEntry({ key: 'route_id', tripId: route.id, vehicleId: fromVehicleId, finishedAt, distance });
}

/** The hook the transfer code calls for shipments: never throws. */
export async function recordShipmentLegAfterTransferSafe(shipmentIds: string[], transferId: string, fromVehicleId: string): Promise<void> {
  try {
    await recordShipmentLegAfterTransfer(shipmentIds, transferId, fromVehicleId);
  } catch (e) {
    console.error('[driver-pay] Could not record the leg pay after a transfer:', e);
  }
}

/** Entries for trips that finished before driver pay existed. Staff choose the first trip date. */
export async function backfillTripPay(actor: AuditActor, fromDate: string) {
  validDate(fromDate, 'from');
  const since = indianDayStart(fromDate).toISOString();
  const [routes, loads] = await Promise.all([
    supabase.from('routes').select('id').eq('status', 'completed').gte('completed_at', since),
    supabase.from('cargo_manifest').select('id').in('status', ['delivered', 'completed']).gte('updated_at', since),
  ]);
  if (routes.error) throw new Error(`Failed to read routes: ${routes.error.message}`);
  if (loads.error) throw new Error(`Failed to read loads: ${loads.error.message}`);
  let created = 0;
  let skipped = 0;
  for (const r of routes.data ?? []) {
    const out = await recordTripPay({ route_id: r.id });
    if (out?.created) created++; else skipped++;
  }
  for (const m of loads.data ?? []) {
    const out = await recordTripPay({ manifest_id: m.id });
    if (out?.created) created++; else skipped++;
  }
  await auditService.record('staff-console', actor, 'driver_pay.backfill', { from: fromDate }, `${created} entries created`);
  return { created, skipped };
}

// ── Staff: entries ──────────────────────────────────────────

export interface EntryFilters { driver_id?: string; status?: string; from?: string; to?: string; vehicle_type?: string; rate_missing?: boolean }

/** Entries for the console, newest trip first, with the driver's name, the plate and the trip they came from. */
export async function listEntries(filters: EntryFilters) {
  let q = supabase.from('driver_pay_entries').select(ENTRY_COLUMNS).order('trip_date', { ascending: false }).limit(LIST_LIMIT);
  if (filters.driver_id) q = q.eq('driver_id', filters.driver_id);
  if (filters.status) {
    if (!(PAY_STATUSES as readonly string[]).includes(filters.status)) throw new HttpError(400, `status must be one of ${PAY_STATUSES.join(', ')}`);
    q = q.eq('status', filters.status);
  }
  if (filters.vehicle_type) q = q.eq('vehicle_type', validType(filters.vehicle_type));
  if (filters.rate_missing) q = q.eq('rate_missing', true);
  if (filters.from) q = q.gte('trip_date', validDate(filters.from, 'from'));
  if (filters.to) q = q.lte('trip_date', validDate(filters.to, 'to'));
  const { data, error } = await q;
  if (error) throw new Error(`Failed to read driver pay: ${error.message}`);
  const entries = data ?? [];
  const [drivers, vehicles, payouts] = await Promise.all([
    selectIn<any>('users', 'id', entries.map((e: any) => e.driver_id), 'id, full_name, phone'),
    selectIn<any>('vehicles', 'id', entries.map((e: any) => e.vehicle_id), 'id, plate_number'),
    selectIn<any>('driver_payouts', 'id', entries.map((e: any) => e.payout_id), 'id, paid_at, method, reference'),
  ]);
  const driverById = new Map(drivers.map(d => [d.id, d]));
  const plateById = new Map(vehicles.map(v => [v.id, v.plate_number]));
  const payoutById = new Map(payouts.map(p => [p.id, p]));
  const rows = entries.map((e: any) => ({
    ...toEntry(e),
    driver_name: driverById.get(e.driver_id)?.full_name ?? null,
    plate_number: plateById.get(e.vehicle_id) ?? null,
    paid_at: payoutById.get(e.payout_id)?.paid_at ?? null,
    payout_method: payoutById.get(e.payout_id)?.method ?? null,
  }));
  const sum = (s: string) => money(rows.filter(r => r.status === s).reduce((t, r) => t + r.amount, 0));
  return {
    entries: rows,
    totals: { earned: sum('earned'), approved: sum('approved'), paid: sum('paid') },
    rate_missing_types: [...new Set(rows.filter(r => r.rate_missing && r.status === 'earned').map(r => r.vehicle_type).filter(Boolean))],
    truncated: entries.length >= LIST_LIMIT,
  };
}

const toEntry = (e: any) => ({
  id: e.id, driver_id: e.driver_id, vehicle_id: e.vehicle_id ?? null, vehicle_type: e.vehicle_type ?? null,
  route_id: e.route_id ?? null, manifest_id: e.manifest_id ?? null, trip_date: String(e.trip_date).slice(0, 10),
  km: num(e.km), km_source: e.km_source as KmSource, per_trip_amount: num(e.per_trip_amount), per_km_amount: num(e.per_km_amount),
  adjustments: (Array.isArray(e.adjustments) ? e.adjustments : []) as PayAdjustment[], amount: num(e.amount),
  rate_missing: !!e.rate_missing, status: e.status as PayStatus, approved_at: e.approved_at ?? null,
  void_reason: e.void_reason ?? null, payout_id: e.payout_id ?? null,
});

async function loadEntry(id: string) {
  const { data, error } = await supabase.from('driver_pay_entries').select(ENTRY_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to read the entry: ${error.message}`);
  if (!data) throw new HttpError(404, 'Pay entry not found');
  return data;
}

/** Approve earned entries. One with no rate yet (amount not real) is skipped with the reason, the rest go through. */
export async function approveEntries(actor: AuditActor, ids: unknown) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || ids.some(i => typeof i !== 'string')) throw new HttpError(400, 'ids must be a list of 1 to 500 entry ids');
  const entries = await selectIn<any>('driver_pay_entries', 'id', ids as string[], ENTRY_COLUMNS);
  const byId = new Map(entries.map(e => [e.id, e]));
  const approved: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const now = new Date().toISOString();
  for (const id of ids as string[]) {
    const e = byId.get(id);
    if (!e) { skipped.push({ id, reason: 'Not found' }); continue; }
    if (e.status !== 'earned') { skipped.push({ id, reason: `Already ${e.status}` }); continue; }
    if (e.rate_missing) { skipped.push({ id, reason: `Set a pay rate for ${e.vehicle_type ?? 'this vehicle type'} first` }); continue; }
    const { data } = await supabase.from('driver_pay_entries')
      .update({ status: 'approved', approved_at: now, approved_by: actor.user_id, updated_at: now })
      .eq('id', id).eq('status', 'earned').select('id').maybeSingle();
    if (data) approved.push(id); else skipped.push({ id, reason: 'Changed by someone else' });
  }
  if (approved.length) await auditService.record('staff-console', actor, 'driver_pay.approved', { entry_ids: approved }, `${approved.length} approved`);
  return { approved, skipped };
}

/** Add a signed correction (a bonus, a toll, a deduction) with the reason. Not after the entry is paid or void. */
export async function adjustEntry(actor: AuditActor, id: string, body: Record<string, any>) {
  const amount = typeof body.amount === 'string' ? Number(body.amount) : body.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1_000_000) throw new HttpError(400, 'amount must be a non-zero amount, positive to add and negative to deduct');
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 3 || reason.length > 300) throw new HttpError(400, 'Give a reason of 3 to 300 characters');
  const entry = await loadEntry(id);
  if (entry.status === 'paid' || entry.status === 'void') throw new HttpError(409, `A ${entry.status} entry can't be adjusted`);
  const adjustments = [...toEntry(entry).adjustments, { amount: money(amount), reason, by: actor.user_id, at: new Date().toISOString() }];
  const next = payAmount(num(entry.per_trip_amount), num(entry.per_km_amount), num(entry.km), adjustments);
  if (next < 0) throw new HttpError(400, 'The deduction is more than the driver is owed for this trip');
  const { data, error } = await supabase.from('driver_pay_entries').update({ adjustments, amount: next, updated_at: new Date().toISOString() })
    .eq('id', id).eq('status', entry.status).select(ENTRY_COLUMNS).maybeSingle();
  if (error) throw new Error(`Failed to adjust the entry: ${error.message}`);
  if (!data) throw new HttpError(409, 'This entry was just changed by someone else. Refresh and try again.');
  await auditService.record('staff-console', actor, 'driver_pay.adjusted', { entry_id: id, driver_id: entry.driver_id, adjustment: money(amount), reason }, `Amount ${num(entry.amount)} -> ${next}`);
  return toEntry(data);
}

/** Void an entry that should not be paid (a wrong trip, a duplicate). Not after it is paid. */
export async function voidEntry(actor: AuditActor, id: string, reasonInput: unknown) {
  const reason = typeof reasonInput === 'string' ? reasonInput.trim() : '';
  if (reason.length < 3 || reason.length > 300) throw new HttpError(400, 'Give a reason of 3 to 300 characters');
  const entry = await loadEntry(id);
  if (entry.status === 'paid') throw new HttpError(409, 'A paid entry can\'t be voided');
  if (entry.status === 'void') return toEntry(entry);
  const now = new Date().toISOString();
  const { data } = await supabase.from('driver_pay_entries').update({ status: 'void', void_reason: reason, voided_at: now, voided_by: actor.user_id, updated_at: now })
    .eq('id', id).eq('status', entry.status).select(ENTRY_COLUMNS).maybeSingle();
  if (!data) throw new HttpError(409, 'This entry was just changed by someone else. Refresh and try again.');
  await auditService.record('staff-console', actor, 'driver_pay.voided', { entry_id: id, driver_id: entry.driver_id, amount: num(entry.amount), reason });
  return toEntry(data);
}

// ── Staff: payouts ──────────────────────────────────────────

/**
 * Pay a driver for approved entries. The money moves outside the app (cash, bank transfer or UPI);
 * this records it: one payout, the entries marked paid, and the driver told with a link to the wallet.
 */
export async function createPayout(actor: AuditActor, body: Record<string, any>) {
  const driverId = typeof body.driver_id === 'string' ? body.driver_id : '';
  if (!driverId) throw new HttpError(400, 'driver_id is required');
  const ids = body.entry_ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || ids.some((i: unknown) => typeof i !== 'string')) throw new HttpError(400, 'Choose 1 to 500 approved entries to pay');
  const method = body.method;
  if (typeof method !== 'string' || !(PAYOUT_METHODS as readonly string[]).includes(method)) throw new HttpError(400, `method must be one of ${PAYOUT_METHODS.join(', ')}`);
  const reference = typeof body.reference === 'string' ? body.reference.trim().slice(0, 120) : '';
  if (method !== 'cash' && reference.length < 3) throw new HttpError(400, method === 'upi' ? 'Enter the UPI transaction reference' : 'Enter the bank transfer reference');
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : null;
  const paidAt = body.paid_at ? new Date(String(body.paid_at)) : new Date();
  if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 86_400_000) throw new HttpError(400, 'paid_at must be a valid date that is not in the future');

  const entries = await selectIn<any>('driver_pay_entries', 'id', ids as string[], ENTRY_COLUMNS);
  if (entries.length !== new Set(ids as string[]).size) throw new HttpError(404, 'Some of these entries no longer exist');
  const bad = entries.find(e => e.driver_id !== driverId || e.status !== 'approved');
  if (bad) throw new HttpError(409, bad.driver_id !== driverId ? 'Every entry must belong to this driver' : `Only approved entries can be paid (one is ${bad.status})`);
  const amount = money(entries.reduce((s, e) => s + num(e.amount), 0));
  if (amount <= 0) throw new HttpError(400, 'These entries add up to ₹0, so there is nothing to pay');
  const dates = entries.map(e => String(e.trip_date).slice(0, 10)).sort();

  const { data: payout, error } = await supabase.from('driver_payouts').insert({
    driver_id: driverId, period_from: dates[0], period_to: dates[dates.length - 1], amount, method,
    reference: reference || null, note, paid_at: paidAt.toISOString(), paid_by: actor.user_id,
  }).select('id, driver_id, period_from, period_to, amount, method, reference, note, paid_at').single();
  if (error) throw new Error(`Failed to save the payout: ${error.message}`);

  const now = new Date().toISOString();
  const { data: marked, error: markErr } = await supabase.from('driver_pay_entries')
    .update({ status: 'paid', payout_id: payout.id, updated_at: now }).in('id', ids as string[]).eq('status', 'approved').eq('driver_id', driverId).select('id');
  if (markErr || (marked ?? []).length !== ids.length) {
    // Someone changed an entry while this was being saved: undo, so the payout total never differs from its entries
    if ((marked ?? []).length > 0) await supabase.from('driver_pay_entries').update({ status: 'approved', payout_id: null, updated_at: now }).in('id', (marked ?? []).map((m: any) => m.id));
    await supabase.from('driver_payouts').delete().eq('id', payout.id);
    if (markErr) throw new Error(`Failed to mark the entries paid: ${markErr.message}`);
    throw new HttpError(409, 'An entry was just changed by someone else. Refresh and try again.');
  }

  await auditService.record('staff-console', actor, 'driver_pay.paid', { driver_id: driverId, payout_id: payout.id, entry_ids: ids, method, reference: reference || null }, `₹${amount}`);
  try {
    await notificationService.sendNotification(
      driverId, 'Payment sent', `${formatRupees(amount)} was paid to you by ${METHOD_LABEL[method as PayoutMethod]}. Open your wallet to see it.`,
      'payout_sent', { payout_id: payout.id, amount, method, link: '/wallet' },
    );
  } catch (e) {
    console.error('[driver-pay] Could not tell the driver about the payout:', e);
  }
  return { payout: { ...payout, amount: num(payout.amount) }, entries: ids.length };
}

const METHOD_LABEL: Record<PayoutMethod, string> = { cash: 'cash', bank: 'bank transfer', upi: 'UPI' };
const formatRupees = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Payouts, newest first, optionally for one driver. */
export async function listPayouts(driverId?: string) {
  let q = supabase.from('driver_payouts').select('id, driver_id, period_from, period_to, amount, method, reference, note, paid_at, paid_by').order('paid_at', { ascending: false }).limit(200);
  if (driverId) q = q.eq('driver_id', driverId);
  const { data, error } = await q;
  if (error) throw new Error(`Failed to read payouts: ${error.message}`);
  const drivers = await selectIn<any>('users', 'id', (data ?? []).map((p: any) => p.driver_id), 'id, full_name');
  const name = new Map(drivers.map(d => [d.id, d.full_name]));
  return (data ?? []).map((p: any) => ({ ...p, amount: num(p.amount), driver_name: name.get(p.driver_id) ?? null }));
}

// ── Driver: their own pay ───────────────────────────────────

/** IST Monday of the week containing `date`, as YYYY-MM-DD. */
export function weekStartKey(date: Date): string {
  const key = indianDateKey(date);
  const day = new Date(`${key}T00:00:00Z`).getUTCDay();
  return indianDateKey(new Date(indianDayStart(key).getTime() - ((day + 6) % 7) * 86_400_000));
}

const tripRef = (e: any) => (e.route_id ? `TR-${String(e.route_id).split('-')[0].toUpperCase()}` : e.manifest_id ? `CM-${String(e.manifest_id).split('-')[0].toUpperCase()}` : 'Trip');

/**
 * What a driver sees in the wallet: totals by state, this trip, week and month, the trips with
 * their amounts and states, and their payouts. Only their own rows; void entries are left out.
 */
export async function getDriverPay(driverId: string, now: Date = new Date()) {
  const [entriesRes, payoutsRes] = await Promise.all([
    supabase.from('driver_pay_entries').select(ENTRY_COLUMNS).eq('driver_id', driverId).neq('status', 'void').order('trip_date', { ascending: false }).limit(500),
    supabase.from('driver_payouts').select('id, period_from, period_to, amount, method, reference, paid_at').eq('driver_id', driverId).order('paid_at', { ascending: false }).limit(50),
  ]);
  if (entriesRes.error) throw new Error(`Failed to read your pay: ${entriesRes.error.message}`);
  if (payoutsRes.error) throw new Error(`Failed to read your payouts: ${payoutsRes.error.message}`);
  const payouts = (payoutsRes.data ?? []).map((p: any) => ({ ...p, amount: num(p.amount) }));
  const paidAt = new Map(payouts.map(p => [p.id, p.paid_at]));
  const entries = (entriesRes.data ?? []).map((e: any) => ({ ...toEntry(e), created_at: e.created_at as string }));

  const sum = (rows: typeof entries) => money(rows.reduce((s, e) => s + e.amount, 0));
  const today = indianDateKey(now);
  const weekStart = weekStartKey(now);
  const monthStart = `${today.slice(0, 8)}01`;
  const inPeriod = (from: string) => entries.filter(e => e.trip_date >= from && e.trip_date <= today);
  const latest = [...entries].sort((a, b) => b.trip_date.localeCompare(a.trip_date) || b.created_at.localeCompare(a.created_at))[0] ?? null;

  const line = (e: (typeof entries)[number]) => ({
    id: e.id, date: e.trip_date, trip_ref: tripRef(e), trip_type: e.route_id ? 'route' : 'load', route_id: e.route_id, manifest_id: e.manifest_id,
    km: e.km, km_source: e.km_source, per_trip_amount: e.per_trip_amount, per_km_amount: e.per_km_amount,
    adjustment_total: adjustmentTotal(e.adjustments), amount: e.amount, status: e.status, rate_missing: e.rate_missing,
    paid_at: e.payout_id ? paidAt.get(e.payout_id) ?? null : null,
  });
  const totalOf = (s: PayStatus) => sum(entries.filter(e => e.status === s));
  return {
    totals: {
      earned: sum(entries), // everything earned so far, in any state
      pending: totalOf('earned'), // waiting for approval
      approved: totalOf('approved'), // approved, not yet paid
      paid: totalOf('paid'),
    },
    this_trip: latest ? line(latest) : null,
    this_week: { total: sum(inPeriod(weekStart)), trips: inPeriod(weekStart).length, from: weekStart },
    this_month: { total: sum(inPeriod(monthStart)), trips: inPeriod(monthStart).length, from: monthStart },
    trips: entries.map(line),
    payouts,
    payout_account: await getPayoutAccount(driverId),
  };
}

/**
 * Totals and the trip lines in the shape older driver apps and the staff person page read
 * (`total_earnings`, `completed_trips`, `recent_invoices`). It is real driver pay, never an invoice amount.
 */
export async function buildEarnings(userId: string, filter: { from?: string; to?: string } = {}) {
  let q = supabase.from('driver_pay_entries').select(ENTRY_COLUMNS).eq('driver_id', userId).neq('status', 'void').order('trip_date', { ascending: false });
  if (filter.from) q = q.gte('trip_date', indianDateKey(new Date(filter.from)));
  if (filter.to) q = q.lte('trip_date', indianDateKey(new Date(filter.to)));
  const { data, error } = await q;
  if (error) throw new Error(`Failed to read your pay: ${error.message}`);
  const entries = (data ?? []).map(toEntry);
  const invoices = entries.map(e => ({
    id: tripRef(e), date: `${e.trip_date}T00:00:00+05:30`, distance_km: e.km, base_pay: money(e.per_trip_amount + e.per_km_amount * e.km),
    bonus: adjustmentTotal(e.adjustments), tax: 0, total_payout: e.amount, status: e.status === 'paid' ? 'paid' : 'pending',
  }));
  return { total_earnings: money(entries.reduce((s, e) => s + e.amount, 0)), completed_trips: entries.length, recent_invoices: invoices };
}
