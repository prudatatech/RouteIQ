/**
 * margixindia — Analytics routes
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES } from '../core/ownership';
import { AnalyticsService } from '../services/analytics.service';
import { settings } from '../core/config';
import { sendError } from '../core/errors';

const router = Router();

// ── GET /insights ──────────────────────────────────────────
router.get('/insights', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!['admin', 'superadmin', 'manager'].includes(req.user!.role)) {
      res.status(403).json({ detail: 'Not authorized to view fleet insights' });
      return;
    }
    const insights = await AnalyticsService.getLiveInsights();
    res.json(insights);
  } catch (e: any) {
    sendError(req, res, e);
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
    sendError(req, res, e);
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
    sendError(req, res, e);
  }
});

// ── GET /daily-activity ────────────────────────────────────
router.get('/daily-activity', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!['admin', 'superadmin', 'manager'].includes(req.user!.role)) {
      res.status(403).json({ detail: 'Not authorized' });
      return;
    }
    const days = parseInt(req.query.days as string, 10) || 14;
    const data = await AnalyticsService.getDailyActivity(days);
    res.json(data);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /active-missions ───────────────────────────────────
router.get('/active-missions', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!['admin', 'superadmin', 'manager'].includes(req.user!.role)) {
      res.status(403).json({ detail: 'Not authorized to view mission incubator' });
      return;
    }
    const missions = await AnalyticsService.getActiveMissions();
    res.json(missions);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /sync-sparkgps ────────────────────────────────────
router.post('/sync-sparkgps', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const { SparkGPSService } = await import('../services/spark-gps.service');
    if (settings.SPARK_GPS_API_TOKEN) {
      await SparkGPSService.fetchAndSync();
      res.json({ status: 'success', message: 'SparkGPS live sync complete' });
    } else {
      res.json({ status: 'not_configured', message: 'SparkGPS credentials are not configured; no sync was performed.' });
    }
  } catch (e: any) {
    sendError(req, res, e);
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

    if (error) throw error;

    // ai_agent_logs has agent_name/action/input_data/output_data/status/created_at —
    // the previous mapping read task_description/action_taken/result, none of which
    // exist on the table, so every row showed "—" regardless of what happened.
    res.json(
      (logs || []).map((log: any) => ({
        id: log.id,
        agent: log.agent_name,
        action: log.action,
        result: typeof log.output_data === 'string' ? log.output_data : (log.output_data ? JSON.stringify(log.output_data) : null),
        status: log.status,
        timestamp: log.created_at,
      }))
    );
  } catch (e: any) {
    sendError(req, res, e);
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
    sendError(req, res, e);
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
    sendError(req, res, e);
  }
});

export default router;
