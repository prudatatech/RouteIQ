/**
 * margixindia — Dashboard Routes
 * Ports: backend/app/api/v1/endpoints/dashboard.py
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES } from '../core/ownership';
import { sendError } from '../core/errors';
import { FUEL_PRICE_PER_LITER } from '../services/analytics.service';
import { startOfIndianDay } from '../core/istDate';
import { getPeopleAttention } from '../services/people-docs.service';
import { OWNED, orgFilter, scopeQuery } from '../core/org-scope';

const router = Router();

// ── GET /kpis ──────────────────────────────────────────────
router.get('/kpis', requireAuth, requireRole(...STAFF_ROLES, 'driver'), async (req: Request, res: Response) => {
  try {
    // "Today" is the Indian calendar day, as in analytics, whatever timezone the server runs in
    const todayISO = startOfIndianDay(0).toISOString();

    let activeVehicles = 0;
    let routesToday: any[] = [];

    if (req.user!.role === 'driver') {
      // Driver-scoped: only their vehicles/routes
      const { data: driverVehicles } = await supabase
        .from('vehicles')
        .select('id')
        .eq('driver_id', req.user!.user_id)
        .eq('status', 'on_route');

      activeVehicles = driverVehicles?.length || 0;

      if (driverVehicles && driverVehicles.length > 0) {
        const vIds = driverVehicles.map((v: any) => v.id);
        const { data: routes } = await supabase
          .from('routes')
          .select('status, estimated_fuel_liters')
          .in('vehicle_id', vIds)
          .gte('created_at', todayISO);
        routesToday = routes || [];
      }
    } else {
      // Admin/manager view
      const [{ count }, { data: routes }] = await Promise.all([
        scopeQuery(supabase.from('vehicles').select('id', { count: 'exact', head: true }).eq('status', 'on_route'), OWNED.carrier),
        scopeQuery(supabase.from('routes').select('status, estimated_fuel_liters').gte('created_at', todayISO), OWNED.carrier),
      ]);
      activeVehicles = count || 0;
      routesToday = routes || [];
    }

    const totalDeliveries = routesToday.length;
    const completed = routesToday.filter((r: any) => r.status === 'completed').length;
    // No fabricated default: with zero routes today there is nothing real
    // to report an on-time rate for.
    const onTimeRate = totalDeliveries > 0 ? (completed / totalDeliveries) * 100 : null;
    const fuelToday = routesToday.reduce((sum: number, r: any) => sum + (r.estimated_fuel_liters || 0), 0) * FUEL_PRICE_PER_LITER;

    // avg_eta_accuracy_pct and rerouting_events_today were derived from
    // on_time_rate_pct / total_deliveries_today via arbitrary constants with
    // no real backing data (no per-stop ETA vs actual-arrival timestamps,
    // no persisted reroute-event log) — removed rather than faked (see D2).
    res.json({
      active_vehicles: activeVehicles,
      on_time_rate_pct: onTimeRate !== null ? parseFloat(onTimeRate.toFixed(1)) : null,
      fuel_cost_today: parseFloat(fuelToday.toFixed(2)),
      total_deliveries_today: totalDeliveries,
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /people-attention ──────────────────────────────────
// Expired and expiring driver licences, and people missing required documents
router.get('/people-attention', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 10, 1), 50);
    res.json(await getPeopleAttention(limit));
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /shipment-counts ───────────────────────────────────
// Exact number of shipments per status. Counted in the database so it stays right on
// fleets with more shipments than a list page can carry.
export const SHIPMENT_STATUSES = [
  'created', 'assigned', 'picked_up', 'in_transit', 'delivered', 'cancelled', 'exception',
  'out_for_delivery', 'at_hub', 'partially_delivered', 'on_hold', 'returning', 'returned', 'lost',
] as const;

router.get('/shipment-counts', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const filter = orgFilter(OWNED.carrier);
    const { data, error } = await supabase.rpc('dashboard_shipment_counts', { p_carrier_org_id: filter?.id ?? null });
    if (error) throw error;
    const counts = Object.fromEntries(SHIPMENT_STATUSES.map(status => [status, 0])) as Record<(typeof SHIPMENT_STATUSES)[number], number>;
    // Vendor loads (cargo manifests) are part of the shipments list, so they are part of its counts:
    // scheduled shows as created, delivered and completed as delivered; the rest keep their names.
    const manifestStatus: Record<string, (typeof SHIPMENT_STATUSES)[number]> = {
      scheduled: 'created', in_transit: 'in_transit', delivered: 'delivered', completed: 'delivered',
      exception: 'exception', on_hold: 'on_hold', returning: 'returning', returned: 'returned',
    };
    for (const row of (data ?? []) as Array<{ source: string; status: string; total: number | string }>) {
      const status = row.source === 'manifest' ? manifestStatus[row.status] : row.status;
      if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status as keyof typeof counts] += Number(row.total);
    }
    res.json({ counts, total: Object.values(counts).reduce((sum, n) => sum + n, 0) });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

export default router;
