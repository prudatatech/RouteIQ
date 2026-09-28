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

const router = Router();

// ── GET /kpis ──────────────────────────────────────────────
router.get('/kpis', requireAuth, requireRole(...STAFF_ROLES, 'driver'), async (req: Request, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

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
          .select('*')
          .in('vehicle_id', vIds)
          .gte('created_at', todayISO);
        routesToday = routes || [];
      }
    } else {
      // Admin/manager view
      const { count } = await supabase
        .from('vehicles')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'on_route');
      activeVehicles = count || 0;

      const { data: routes } = await supabase
        .from('routes')
        .select('*')
        .gte('created_at', todayISO);
      routesToday = routes || [];
    }

    const totalDeliveries = routesToday.length;
    const completed = routesToday.filter((r: any) => r.status === 'completed').length;
    // No fabricated default: with zero routes today there is nothing real
    // to report an on-time rate for.
    const onTimeRate = totalDeliveries > 0 ? (completed / totalDeliveries) * 100 : null;
    const fuelToday = routesToday.reduce((sum: number, r: any) => sum + (r.estimated_fuel_liters || 0), 0) * FUEL_PRICE_PER_LITER;
    const avgScore = routesToday.reduce((sum: number, r: any) => sum + (r.optimization_score || 0.8), 0) / Math.max(1, routesToday.length);
    const fuelSavedPct = avgScore * 20;

    // avg_eta_accuracy_pct and rerouting_events_today were derived from
    // on_time_rate_pct / total_deliveries_today via arbitrary constants with
    // no real backing data (no per-stop ETA vs actual-arrival timestamps,
    // no persisted reroute-event log) — removed rather than faked (see D2).
    res.json({
      active_vehicles: activeVehicles,
      on_time_rate_pct: onTimeRate !== null ? parseFloat(onTimeRate.toFixed(1)) : null,
      fuel_cost_today: parseFloat(fuelToday.toFixed(2)),
      fuel_saved_pct: parseFloat(fuelSavedPct.toFixed(1)),
      total_deliveries_today: totalDeliveries,
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

export default router;
