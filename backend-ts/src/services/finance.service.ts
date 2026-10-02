/**
 * margixindia — Finance
 *
 * Profit and loss from three real sources, and nothing else:
 *   - revenue: invoices (amount before GST), by the day they were issued
 *   - costs: the expense log, by expense date, and what 3PL partners charged for the loads they
 *     delivered (their agreed amount, by delivery date)
 *   - fuel estimate: litres x the fuel price setting, for completed routes that
 *     have no fuel expense recorded against them or their vehicle in the range
 * Revenue is the taxable value (before GST); the GST on those invoices is reported next to it, never inside it.
 * When costs are incomplete (no fuel price, or completed trips with no cost recorded) the summary says so in
 * `costs_status`, so profit is never shown as if it were complete.
 * Anything that cannot be worked out (no fuel price set, no distance) is
 * reported as missing, never replaced by a made-up number.
 */
import { supabase } from '../core/supabase';
import { memoize } from '../core/memo';
import { manifestParcelCode } from '../core/parcelCode';
import { indianDateKey } from '../core/istDate';
import { OWNED, scopeQuery } from '../core/org-scope';

export const EXPENSE_CATEGORIES = ['fuel', 'maintenance', 'toll', 'driver', 'other'] as const;
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];

export const FUEL_PRICE_KEY = 'fuel_price_per_litre';
export const RATE_PER_KM_KEY = 'rate_per_km';

const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  fuel: 'Fuel', maintenance: 'Maintenance', toll: 'Tolls', driver: 'Driver pay', other: 'Other',
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Runs an `in` query in chunks so a long id list does not overflow the request URL. */
export async function selectIn<T = any>(table: string, column: string, ids: string[], columns: string, extra?: (q: any) => any): Promise<T[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 100) chunks.push(unique.slice(i, i + 100));
  // Chunks are independent, so they run together; the rows come back in chunk order
  const pages = await Promise.all(chunks.map(async chunk => {
    let query = supabase.from(table).select(columns).in(column, chunk);
    if (extra) query = extra(query);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    return (data ?? []) as T[];
  }));
  return pages.flat();
}

/** A setting stored as jsonb: a bare number, or an object like {"price": 92} / {"rate": 15}. */
function settingNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    for (const key of ['price', 'rate', 'value']) {
      const n = Number(v[key]);
      if (v[key] != null && Number.isFinite(n)) return n;
    }
  }
  return null;
}

type FinanceSettings = { fuel_price_per_litre: number | null; rate_per_km: number | null };

const loadFinanceSettings = memoize(30_000, async (): Promise<FinanceSettings> => {
  const { data, error } = await supabase.from('system_settings').select('key, value').in('key', [FUEL_PRICE_KEY, RATE_PER_KM_KEY]);
  if (error) throw new Error(`Failed to read settings: ${error.message}`);
  const byKey = new Map((data ?? []).map((r: any) => [r.key, settingNumber(r.value)]));
  return {
    fuel_price_per_litre: byKey.get(FUEL_PRICE_KEY) ?? null,
    rate_per_km: byKey.get(RATE_PER_KM_KEY) ?? null,
  };
});

/**
 * The finance settings as they are now. `{ cached: true }` is for the profit and loss page: the same
 * for every user and rarely changed, so read at most every 30 s there (setFuelPrice clears it).
 */
export async function getFinanceSettings(opts: { cached?: boolean } = {}): Promise<FinanceSettings> {
  if (!opts.cached) loadFinanceSettings.clear();
  return { ...(await loadFinanceSettings()) };
}

export async function setFuelPrice(price: number): Promise<void> {
  const { error } = await supabase
    .from('system_settings')
    .upsert({ key: FUEL_PRICE_KEY, value: { price }, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  loadFinanceSettings.clear();
  if (error) throw new Error(`Failed to save fuel price: ${error.message}`);
}

export interface FinanceRange {
  start: Date;
  end: Date;
}

interface RouteRow {
  id: string;
  vehicle_id: string | null;
  total_distance_km: number | null;
  estimated_fuel_liters: number | null;
  completed_at: string | null;
  status?: string | null;
}

/** Fuel litres for a route: its own estimate, else distance / the vehicle's rated km per litre. */
function routeLitres(route: RouteRow, kmpl: number | null): number | null {
  const est = num(route.estimated_fuel_liters);
  if (est > 0) return est;
  const km = num(route.total_distance_km);
  if (km > 0 && kmpl && kmpl > 0) return km / kmpl;
  return null;
}

export interface CostsStatus {
  complete: boolean;
  fuel_price_missing: boolean;
  /** Completed trips in the range with no expense, and no fuel estimate, against them. */
  trips_without_costs: number;
  trips_completed: number;
  /** One line to show next to profit, e.g. "Costs incomplete: fuel price not set; 7 trips have no costs". Null when complete. */
  note: string | null;
}

/** Whether the costs behind a profit figure are complete, and the sentence that says what is missing. */
export function costsIncomplete(fuelPriceMissing: boolean, tripsWithoutCosts: number, tripsCompleted: number): CostsStatus {
  const reasons: string[] = [];
  if (fuelPriceMissing) reasons.push('fuel price not set');
  if (tripsWithoutCosts > 0) reasons.push(`${tripsWithoutCosts} ${tripsWithoutCosts === 1 ? 'trip has' : 'trips have'} no costs`);
  return {
    complete: reasons.length === 0,
    fuel_price_missing: fuelPriceMissing,
    trips_without_costs: tripsWithoutCosts,
    trips_completed: tripsCompleted,
    note: reasons.length ? `Costs incomplete: ${reasons.join('; ')}` : null,
  };
}

export async function getFinanceSummary(range: FinanceRange) {
  const startISO = range.start.toISOString();
  const endISO = range.end.toISOString();
  const fromKey = indianDateKey(range.start);
  const toKey = indianDateKey(new Date(range.end.getTime() - 1));
  const inRange = (iso: string | null | undefined) => !!iso && iso >= startISO && iso < endISO;

  const [settings, invoiceRes, expenseRes, routeRes, tplRes] = await Promise.all([
    getFinanceSettings({ cached: true }),
    scopeQuery(supabase.from('invoices').select('id, shipment_id, manifest_id, vendor_id, amount, gst_amount, total, status, issued_at')
      .neq('status', 'void').gte('issued_at', startISO).lt('issued_at', endISO), OWNED.invoice),
    scopeQuery(supabase.from('expenses').select('id, vehicle_id, route_id, category, amount, expense_date')
      .gte('expense_date', fromKey).lte('expense_date', toKey), OWNED.carrier),
    scopeQuery(supabase.from('routes').select('id, vehicle_id, total_distance_km, estimated_fuel_liters, completed_at, status')
      .eq('status', 'completed').gte('completed_at', startISO).lt('completed_at', endISO), OWNED.carrier),
    scopeQuery(supabase.from('tpl_orders').select('id, agreed_amount, delivered_at')
      .eq('status', 'delivered').gte('delivered_at', startISO).lt('delivered_at', endISO), OWNED.carrier),
  ]);
  if (tplRes.error) throw new Error(`Failed to read 3PL orders: ${tplRes.error.message}`);
  if (invoiceRes.error) throw new Error(`Failed to read invoices: ${invoiceRes.error.message}`);
  if (expenseRes.error) throw new Error(`Failed to read expenses: ${expenseRes.error.message}`);
  if (routeRes.error) throw new Error(`Failed to read routes: ${routeRes.error.message}`);

  const invoices = (invoiceRes.data ?? []).filter((i: any) => inRange(i.issued_at));
  const expenses = (expenseRes.data ?? []).filter((e: any) => e.expense_date >= fromKey && e.expense_date <= toKey);
  const routes = ((routeRes.data ?? []) as RouteRow[]).filter(r => inRange(r.completed_at));
  const tplOrders = (tplRes.data ?? []).filter((o: any) => inRange(o.delivered_at));

  // Where each invoice was earned: shipment -> delivery point -> route stop -> route -> vehicle
  const shipmentIds = invoices.map((i: any) => i.shipment_id).filter(Boolean);
  const manifestIds = invoices.map((i: any) => i.manifest_id).filter(Boolean);
  // The shipment chain (points then stops) and the manifests do not depend on each other
  const [{ points, stops }, manifests] = await Promise.all([
    (async () => {
      const points = await selectIn<{ id: string; shipment_id: string }>('delivery_points', 'shipment_id', shipmentIds, 'id, shipment_id');
      const stops = await selectIn<{ delivery_point_id: string; route_id: string }>('route_stops', 'delivery_point_id', points.map(p => p.id), 'delivery_point_id, route_id');
      return { points, stops };
    })(),
    selectIn<{ id: string; vehicle_id: string | null; pickup_location: string | null; drop_location: string | null }>(
      'cargo_manifest', 'id', manifestIds, 'id, vehicle_id, pickup_location, drop_location'),
  ]);

  const routeByShipment = new Map<string, string>();
  const pointShipment = new Map(points.map(p => [p.id, p.shipment_id]));
  for (const s of stops) {
    const shipment = pointShipment.get(s.delivery_point_id);
    if (shipment && !routeByShipment.has(shipment)) routeByShipment.set(shipment, s.route_id);
  }
  const knownRoutes = new Map(routes.map(r => [r.id, r]));
  const extraRouteIds = [...new Set(routeByShipment.values())].filter(id => !knownRoutes.has(id));
  const extraRoutes = await selectIn<RouteRow>('routes', 'id', extraRouteIds, 'id, vehicle_id, total_distance_km, estimated_fuel_liters, completed_at, status');
  const routeInfo = new Map<string, RouteRow>([...knownRoutes, ...extraRoutes.map(r => [r.id, r] as const)]);
  const manifestInfo = new Map(manifests.map(m => [m.id, m]));

  const vehicleIds = [
    ...routeInfo.values(), ...manifests, ...expenses,
  ].map((r: any) => r.vehicle_id).filter(Boolean) as string[];
  const vehicles = await selectIn<{ id: string; plate_number: string; fuel_efficiency_kmpl: number | null }>(
    'vehicles', 'id', vehicleIds, 'id, plate_number, fuel_efficiency_kmpl');
  const vehicleInfo = new Map(vehicles.map(v => [v.id, v]));

  // Fuel that is already an expense covers the estimate: for that route, or for that vehicle in this range
  const fuelExpenses = expenses.filter((e: any) => e.category === 'fuel');
  const fuelRoutes = new Set(fuelExpenses.map((e: any) => e.route_id).filter(Boolean));
  const fuelVehicles = new Set(fuelExpenses.map((e: any) => e.vehicle_id).filter(Boolean));

  const fuelPrice = settings.fuel_price_per_litre;
  const fuelEstimateByRoute = new Map<string, number>();
  let routesWithoutFuel = 0;
  let routesCovered = 0;
  for (const r of routes) {
    if (fuelRoutes.has(r.id) || (r.vehicle_id && fuelVehicles.has(r.vehicle_id))) { routesCovered++; continue; }
    const litres = routeLitres(r, r.vehicle_id ? num(vehicleInfo.get(r.vehicle_id)?.fuel_efficiency_kmpl) || null : null);
    if (litres == null) { routesWithoutFuel++; continue; }
    if (fuelPrice != null) fuelEstimateByRoute.set(r.id, round2(litres * fuelPrice));
  }
  const fuelEstimated = round2([...fuelEstimateByRoute.values()].reduce((s, v) => s + v, 0));

  // Completed trips with nothing recorded against them: no expense on the trip, none on its vehicle in this range, no fuel estimate
  const expenseRoutes = new Set(expenses.map((e: any) => e.route_id).filter(Boolean));
  const expenseVehicles = new Set(expenses.map((e: any) => e.vehicle_id).filter(Boolean));
  const tripsWithoutCosts = routes.filter(r => !expenseRoutes.has(r.id) && !(r.vehicle_id && expenseVehicles.has(r.vehicle_id)) && !fuelEstimateByRoute.has(r.id)).length;

  // Totals
  const revenue = round2(invoices.reduce((s: number, i: any) => s + num(i.amount), 0));
  const gst = round2(invoices.reduce((s: number, i: any) => s + num(i.gst_amount), 0));
  const outstanding = round2(invoices.filter((i: any) => i.status === 'issued').reduce((s: number, i: any) => s + num(i.total ?? i.amount), 0));
  const byCategory = new Map<ExpenseCategory, number>(EXPENSE_CATEGORIES.map(c => [c, 0]));
  for (const e of expenses) byCategory.set(e.category, (byCategory.get(e.category as ExpenseCategory) ?? 0) + num(e.amount));
  // What partners charged for delivered loads is a cost of those loads
  const tplCosts = round2(tplOrders.reduce((s: number, o: any) => s + num(o.agreed_amount), 0));
  const recordedCosts = round2([...byCategory.values()].reduce((s, v) => s + v, 0) + tplCosts);
  const totalCosts = round2(recordedCosts + fuelEstimated);
  const netProfit = round2(revenue - totalCosts);
  const distanceKm = round2(routes.reduce((s, r) => s + num(r.total_distance_km), 0));

  // Per vehicle and per route
  interface Bucket { revenue: number; costs: number }
  const perVehicle = new Map<string, Bucket>();
  const perRoute = new Map<string, Bucket>();
  const bucket = (m: Map<string, Bucket>, id: string) => {
    if (!m.has(id)) m.set(id, { revenue: 0, costs: 0 });
    return m.get(id)!;
  };
  const corridors = new Map<string, { pickup: string; drop: string; revenue: number; loads: number }>();
  for (const i of invoices as any[]) {
    const amount = num(i.amount);
    if (i.shipment_id) {
      const routeId = routeByShipment.get(i.shipment_id);
      if (routeId) {
        bucket(perRoute, routeId).revenue += amount;
        const v = routeInfo.get(routeId)?.vehicle_id;
        if (v) bucket(perVehicle, v).revenue += amount;
      }
    } else if (i.manifest_id) {
      const m = manifestInfo.get(i.manifest_id);
      if (m?.vehicle_id) bucket(perVehicle, m.vehicle_id).revenue += amount;
      const pickup = m?.pickup_location?.trim();
      const drop = m?.drop_location?.trim();
      if (pickup && drop) {
        const key = `${pickup}\u0000${drop}`;
        const c = corridors.get(key) ?? { pickup, drop, revenue: 0, loads: 0 };
        c.revenue += amount;
        c.loads += 1;
        corridors.set(key, c);
      }
    }
  }
  for (const e of expenses as any[]) {
    const amount = num(e.amount);
    if (e.vehicle_id) bucket(perVehicle, e.vehicle_id).costs += amount;
    if (e.route_id) bucket(perRoute, e.route_id).costs += amount;
  }
  for (const [routeId, amount] of fuelEstimateByRoute) {
    bucket(perRoute, routeId).costs += amount;
    const v = routeInfo.get(routeId)?.vehicle_id;
    if (v) bucket(perVehicle, v).costs += amount;
  }
  for (const r of routes) if (r.vehicle_id) bucket(perVehicle, r.vehicle_id);

  const vehicleRows = [...perVehicle].map(([id, b]) => ({
    vehicle_id: id,
    plate_number: vehicleInfo.get(id)?.plate_number ?? 'Unknown vehicle',
    revenue: round2(b.revenue),
    costs: round2(b.costs),
    profit: round2(b.revenue - b.costs),
  })).sort((a, b) => b.profit - a.profit);

  const routeRows = [...perRoute]
    .filter(([, b]) => b.revenue > 0 || b.costs > 0)
    .map(([id, b]) => {
      const info = routeInfo.get(id);
      return {
        route_id: id,
        plate_number: (info?.vehicle_id && vehicleInfo.get(info.vehicle_id)?.plate_number) || null,
        completed_at: info?.completed_at ?? null,
        status: info?.status ?? null,
        distance_km: info?.total_distance_km != null ? round2(num(info.total_distance_km)) : null,
        revenue: round2(b.revenue),
        costs: round2(b.costs),
        profit: round2(b.revenue - b.costs),
        fuel_estimated: fuelEstimateByRoute.has(id),
      };
    })
    .sort((a, b) => b.profit - a.profit);

  // Daily series (IST days), capped at 90
  const dayCount = Math.min(90, Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000)));
  const firstDay = dayCount < Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000)
    ? new Date(range.end.getTime() - dayCount * 86_400_000)
    : range.start;
  const daily = new Map<string, { revenue: number; costs: number }>();
  for (let i = 0; i < dayCount; i++) daily.set(indianDateKey(new Date(firstDay.getTime() + i * 86_400_000)), { revenue: 0, costs: 0 });
  for (const i of invoices as any[]) {
    const d = daily.get(indianDateKey(new Date(i.issued_at)));
    if (d) d.revenue += num(i.amount);
  }
  for (const e of expenses as any[]) {
    const d = daily.get(e.expense_date);
    if (d) d.costs += num(e.amount);
  }
  for (const o of tplOrders as any[]) {
    const d = daily.get(indianDateKey(new Date(o.delivered_at)));
    if (d) d.costs += num(o.agreed_amount);
  }
  for (const r of routes) {
    const amount = fuelEstimateByRoute.get(r.id);
    const d = amount && r.completed_at ? daily.get(indianDateKey(new Date(r.completed_at))) : undefined;
    if (d) d.costs += amount!;
  }

  const activeTrucks = vehicleRows.length;
  const costsStatus = costsIncomplete(fuelPrice == null, tripsWithoutCosts, routes.length);
  return {
    range: { from: fromKey, to: toKey },
    revenue,
    /** `revenue` is the taxable value of the invoices, before GST. */
    revenue_basis: 'taxable_value' as const,
    gst_collected: gst,
    outstanding,
    invoice_count: invoices.length,
    costs: {
      total: totalCosts,
      recorded: recordedCosts,
      fuel_estimated: fuelEstimated,
      by_category: [
        ...EXPENSE_CATEGORIES.map(c => ({ category: c, label: CATEGORY_LABEL[c], amount: round2(byCategory.get(c) ?? 0), estimated: false })),
        { category: 'tpl_partner', label: '3PL partners', amount: tplCosts, estimated: false },
        { category: 'fuel_estimated', label: 'Fuel (estimated)', amount: fuelEstimated, estimated: true },
      ],
    },
    costs_status: costsStatus,
    net_profit: netProfit,
    active_trucks: activeTrucks,
    profit_per_truck: activeTrucks > 0 ? round2(netProfit / activeTrucks) : null,
    distance_km: distanceKm,
    cost_per_km: distanceKm > 0 ? round2(totalCosts / distanceKm) : null,
    fuel: {
      price_per_litre: fuelPrice,
      price_missing: fuelPrice == null,
      routes_covered_by_expenses: routesCovered,
      routes_without_fuel_data: routesWithoutFuel,
    },
    daily: [...daily].map(([date, d]) => ({ date, revenue: round2(d.revenue), costs: round2(d.costs), profit: round2(d.revenue - d.costs) })),
    vehicles: vehicleRows,
    routes: routeRows.slice(0, 10),
    corridors: [...corridors.values()].map(c => ({ ...c, revenue: round2(c.revenue) })).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
  };
}

/** Deliveries in the range that have no invoice, and whether a price exists so one can be created. */
export async function getUnpricedDeliveries(range: FinanceRange) {
  const startISO = range.start.toISOString();
  const endISO = range.end.toISOString();
  const [shipRes, manRes] = await Promise.all([
    scopeQuery(supabase.from('shipments').select('id, tracking_id, origin_name, bid_id, freight_charge, updated_at, is_master, parent_shipment_id, freight_share, status, pieces_total, pieces_delivered, pieces_short, pieces_returned').in('status', ['delivered', 'partially_delivered']).gte('updated_at', startISO).lt('updated_at', endISO), OWNED.carrierAndVendor),
    scopeQuery(supabase.from('cargo_manifest').select('id, vendor_request_id, pickup_location, drop_location, updated_at, is_master, parent_manifest_id, freight_share, lot_label').eq('status', 'delivered').gte('updated_at', startISO).lt('updated_at', endISO), OWNED.carrierAndVendor),
  ]);
  if (shipRes.error) throw new Error(`Failed to read shipments: ${shipRes.error.message}`);
  if (manRes.error) throw new Error(`Failed to read manifests: ${manRes.error.message}`);
  // A master is billed only for the part it kept (its freight_share); its lots are billed on their own
  const ownPart = (r: any) => !r.is_master || num(r.freight_share) > 0;
  // A partial delivery is unpriced only once settled: nothing left on a vehicle or at a hub
  const settledPartial = (s: any) => s.status !== 'partially_delivered' || s.is_master || s.pieces_total == null
    || num(s.pieces_total) - num(s.pieces_delivered) - num(s.pieces_short) - num(s.pieces_returned) <= 0;
  const shipments = (shipRes.data ?? []).filter((s: any) => ownPart(s) && settledPartial(s) && s.updated_at >= startISO && s.updated_at < endISO);
  // A manifest without a vendor request came from a won bid and is billed on its shipment
  const manifests = (manRes.data ?? []).filter((m: any) => m.vendor_request_id && ownPart(m) && m.updated_at >= startISO && m.updated_at < endISO);

  // The invoice, bid and vendor-request lookups do not depend on each other: one round of queries
  const [invoiced, bids, requests] = await Promise.all([
    Promise.all([
      selectIn<{ shipment_id: string }>('invoices', 'shipment_id', shipments.map((s: any) => s.id), 'shipment_id', q => q.neq('status', 'void')),
      selectIn<{ manifest_id: string }>('invoices', 'manifest_id', manifests.map((m: any) => m.id), 'manifest_id', q => q.neq('status', 'void')),
    ]),
    selectIn<{ id: string; bid_amount: number; status: string }>('capacity_bids', 'id', shipments.map((s: any) => s.bid_id), 'id, bid_amount, status'),
    selectIn<{ id: string; cost: number | null }>('vendor_shipment_requests', 'id', manifests.map((m: any) => m.vendor_request_id), 'id, cost'),
  ]);
  const invoicedShipments = new Set(invoiced[0].map(i => i.shipment_id));
  const invoicedManifests = new Set(invoiced[1].map(i => i.manifest_id));
  const wonBids = new Set(bids.filter(b => b.status === 'won' && num(b.bid_amount) > 0).map(b => b.id));
  const pricedRequests = new Set(requests.filter(r => num(r.cost) > 0).map(r => r.id));

  return [
    ...shipments.filter((s: any) => !invoicedShipments.has(s.id)).map((s: any) => ({
      kind: 'shipment' as const,
      id: s.id,
      label: s.tracking_id ?? s.id,
      detail: s.origin_name ?? null,
      delivered_at: s.updated_at,
      can_invoice: s.is_master || s.parent_shipment_id ? num(s.freight_share) > 0 : (!!s.bid_id && wonBids.has(s.bid_id)) || num(s.freight_charge) > 0,
    })),
    ...manifests.filter((m: any) => !invoicedManifests.has(m.id)).map((m: any) => ({
      kind: 'manifest' as const,
      id: m.id,
      label: m.parent_manifest_id && m.lot_label ? `${manifestParcelCode(String(m.parent_manifest_id))}-${m.lot_label}` : manifestParcelCode(String(m.id)),
      detail: [m.pickup_location, m.drop_location].filter(Boolean).join(' to ') || null,
      delivered_at: m.updated_at,
      can_invoice: m.is_master || m.parent_manifest_id ? num(m.freight_share) > 0 : pricedRequests.has(m.vendor_request_id),
    })),
  ].sort((a, b) => String(b.delivered_at).localeCompare(String(a.delivered_at)));
}
