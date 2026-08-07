/**
 * RouteIQ — Analytics Routes (v2)
 * Full Fleet Intelligence endpoints
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth } from '../core/auth';
import { AnalyticsService } from '../services/analytics.service';
import { settings } from '../core/config';

const router = Router();

// ── GET /insights ──────────────────────────────────────────
router.get('/insights', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!['admin', 'superadmin', 'manager', 'driver'].includes(req.user!.role)) {
      res.status(403).json({ detail: 'Not authorized to view fleet insights' });
      return;
    }
    const insights = await AnalyticsService.getLiveInsights();
    res.json(insights);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /metrics ───────────────────────────────────────────
router.get('/metrics', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!['admin', 'superadmin', 'manager'].includes(req.user!.role)) {
      res.status(403).json({ detail: 'Not authorized to view fleet metrics' });
      return;
    }
    const stats = await AnalyticsService.getFleetStats();
    res.json(stats);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /fleet-overview ────────────────────────────────────
router.get('/fleet-overview', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!['admin', 'superadmin', 'manager'].includes(req.user!.role)) {
      res.status(403).json({ detail: 'Not authorized to view fleet overview' });
      return;
    }
    const data = await AnalyticsService.getFleetOverview();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /vehicle-health ────────────────────────────────────
router.get('/vehicle-health', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!['admin', 'superadmin', 'manager'].includes(req.user!.role)) {
      res.status(403).json({ detail: 'Not authorized to view vehicle health' });
      return;
    }
    const data = await AnalyticsService.getVehicleHealth();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /profitable-routes ─────────────────────────────────
router.get('/profitable-routes', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!['admin', 'superadmin', 'manager'].includes(req.user!.role)) {
      res.status(403).json({ detail: 'Not authorized to view route profitability' });
      return;
    }
    const data = await AnalyticsService.getMostProfitableRoutes();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /active-missions ───────────────────────────────────
router.get('/active-missions', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!['admin', 'superadmin', 'manager', 'driver'].includes(req.user!.role)) {
      res.status(403).json({ detail: 'Not authorized to view mission incubator' });
      return;
    }
    const missions = await AnalyticsService.getActiveMissions();
    res.json(missions);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── POST /sync-sparkgps ────────────────────────────────────
router.post('/sync-sparkgps', requireAuth, async (_req: Request, res: Response) => {
  try {
    const { SparkGPSService } = await import('../services/spark-gps.service');
    if (settings.SPARK_GPS_API_TOKEN) {
      await SparkGPSService.fetchAndSync();
      res.json({ status: 'success', message: 'SparkGPS live sync complete' });
    } else {
      await SparkGPSService.mockSyncForDemo();
      res.json({ status: 'success', message: 'SparkGPS Mock Sync (Demonstration Mode) complete' });
    }
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /audit-logs ────────────────────────────────────────
router.get('/audit-logs', requireAuth, async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== 'superadmin') {
      res.status(403).json({ detail: 'Only superadmins can view audit logs' });
      return;
    }
    const { data: logs, error } = await supabase
      .from('ai_agent_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) { res.status(500).json({ detail: error.message }); return; }

    res.json(
      (logs || []).map((log: any) => ({
        id: log.id,
        agent: log.agent_name,
        task: log.task_description,
        action: log.action_taken,
        result: log.result,
        status: log.status,
        timestamp: log.created_at,
      }))
    );
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /driver-performance ──────────────────────────────────
router.get('/driver-performance', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!['admin', 'superadmin', 'manager'].includes(req.user!.role)) {
      res.status(403).json({ detail: 'Not authorized' });
      return;
    }
    const data = await AnalyticsService.getDriverPerformance();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /financials ──────────────────────────────────────────
router.get('/financials', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!['admin', 'superadmin', 'manager'].includes(req.user!.role)) {
      res.status(403).json({ detail: 'Not authorized' });
      return;
    }
    const data = await AnalyticsService.getFinancialMetrics();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /vendor-performance ──────────────────────────────────
router.get('/vendor-performance', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!['admin', 'superadmin', 'manager'].includes(req.user!.role)) {
      res.status(403).json({ detail: 'Not authorized' });
      return;
    }
    const data = await AnalyticsService.getVendorPerformance();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

export default router;
