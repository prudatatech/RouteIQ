/**
 * RouteIQ — Analytics Routes
 * Ports: backend/app/api/v1/endpoints/analytics.py
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
    // Import SparkGPS service dynamically
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

export default router;
