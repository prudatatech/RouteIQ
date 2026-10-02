/**
 * margixindia — Analytics routes
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES } from '../core/ownership';
import { AnalyticsService } from '../services/analytics.service';
import { getDemandOverview } from '../services/demand.service';
import { settings } from '../core/config';
import { sendError } from '../core/errors';
import { auditEntriesForOrg } from '../services/audit.service';
import { memberOrgId } from '../core/org-scope';
import { indianDayEnd, indianDayStart, resolveIndianDateRange } from '../core/istDate';

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

// ── GET /demand ────────────────────────────────────────────
// Open loads vs available vehicles per origin city, and a 7-day load forecast per corridor.
router.get('/demand', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!['admin', 'superadmin', 'manager'].includes(req.user!.role)) {
      res.status(403).json({ detail: 'Not authorized to view demand' });
      return;
    }
    res.json(await getDemandOverview());
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
// Defaults to today (IST); pass from/to (YYYY-MM-DD, IST calendar days) to
// report on a different range, e.g. from the shared DateRangeControl.
router.get('/fleet-overview', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!['admin', 'superadmin', 'manager'].includes(req.user!.role)) {
      res.status(403).json({ detail: 'Not authorized to view fleet overview' });
      return;
    }
    const hasRange = typeof req.query.from === 'string' || typeof req.query.to === 'string';
    const range = hasRange ? resolveIndianDateRange(req.query.from, req.query.to, 1) : undefined;
    const data = await AnalyticsService.getFleetOverview(range);
    res.json(data);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /daily-activity ────────────────────────────────────
// `days` (default 14, back-compat) or an explicit from/to (YYYY-MM-DD, IST
// calendar days) range; from/to takes priority when both are given.
router.get('/daily-activity', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!['admin', 'superadmin', 'manager'].includes(req.user!.role)) {
      res.status(403).json({ detail: 'Not authorized' });
      return;
    }
    const days = parseInt(req.query.days as string, 10) || 14;
    const hasRange = typeof req.query.from === 'string' || typeof req.query.to === 'string';
    const range = hasRange ? resolveIndianDateRange(req.query.from, req.query.to, days) : undefined;
    const data = await AnalyticsService.getDailyActivity(range, days);
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
// Supports offset/limit paging and an optional from/to (YYYY-MM-DD, IST
// calendar days) date range so the console can page through history instead
// of only ever seeing the latest 100 entries.
const AUDIT_LOG_DEFAULT_LIMIT = 100;
const AUDIT_LOG_MAX_LIMIT = 200;

router.get('/audit-logs', requireAuth, async (req: Request, res: Response) => {
  try {
    // A company's admins read its own entries; only the platform reads everyone's
    if (req.user!.role !== 'superadmin' && !(req.user!.role === 'admin' && memberOrgId())) {
      res.status(403).json({ detail: 'Only admins can view audit logs' });
      return;
    }

    const limit = Math.min(AUDIT_LOG_MAX_LIMIT, Math.max(1, parseInt(req.query.limit as string, 10) || AUDIT_LOG_DEFAULT_LIMIT));
    const offset = Math.max(0, parseInt(req.query.offset as string, 10) || 0);

    const fromStr = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : null;
    const toStr = typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : null;
    const want = offset + limit + 1; // +1 tells us whether there's another page, without a separate count query
    const readPage = async (from: number, count: number) => {
      let query = supabase.from('ai_agent_logs').select('*').order('created_at', { ascending: false }).range(from, from + count - 1);
      if (fromStr) query = query.gte('created_at', indianDayStart(fromStr).toISOString());
      if (toStr) query = query.lt('created_at', indianDayEnd(toStr).toISOString());
      const { data, error: readError } = await query;
      if (readError) throw readError;
      return data || [];
    };

    // A company sees only its own entries, so the table is read page by page until enough of them are found
    let logs: any[];
    if (memberOrgId()) {
      logs = [];
      const pageSize = 500;
      for (let from = 0, pages = 0; logs.length < want && pages < 20; from += pageSize, pages++) {
        const page = await readPage(from, pageSize);
        logs.push(...(await auditEntriesForOrg(page)));
        if (page.length < pageSize) break;
      }
    } else {
      logs = await readPage(0, want);
    }

    // ai_agent_logs has agent_name/action/input_data/output_data/status/created_at —
    // the previous mapping read task_description/action_taken/result, none of which
    // exist on the table, so every row showed "—" regardless of what happened.
    const page = (logs || []).slice(offset, offset + limit);
    const hasMore = (logs || []).length > offset + limit;
    const items = page.map((log: any) => ({
      id: log.id,
      agent: log.agent_name,
      action: log.action,
      result: typeof log.output_data === 'string' ? log.output_data : (log.output_data ? JSON.stringify(log.output_data) : null),
      status: log.status,
      timestamp: log.created_at,
    }));

    res.json({ items, limit, offset, hasMore });
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
