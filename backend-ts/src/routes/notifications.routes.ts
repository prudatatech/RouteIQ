/**
 * margixindia — Notifications
 *
 * In-app notifications for the signed-in user (driver, customer, vendor,
 * admin, superadmin — any role). Every query and mutation is scoped to the
 * caller's own `user_id`; nobody can read or mark another user's rows.
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth } from '../core/auth';
import { sendError, HttpError } from '../core/errors';

const router = Router();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePaging(req: Request): { limit: number; offset: number } {
  const rawLimit = Number(req.query.limit);
  const rawOffset = Number(req.query.offset);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.floor(rawOffset) : 0;
  return { limit, offset };
}

/** GET /notifications — the caller's own notifications, newest first. */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const { limit, offset } = parsePaging(req);

    const { data, error, count } = await supabase
      .from('notifications')
      .select('id, title, body, type, is_read, data, created_at', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new HttpError(500, error.message);

    const { count: unreadCount } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    res.json({
      notifications: data ?? [],
      total: count ?? (data ?? []).length,
      unread_count: unreadCount ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    sendError(req, res, err);
  }
});

/** POST /notifications/:id/read — mark one of the caller's own notifications read. */
router.post('/:id/read', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .select('id, title, body, type, is_read, data, created_at')
      .maybeSingle();

    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, 'Notification not found');

    res.json(data);
  } catch (err) {
    sendError(req, res, err);
  }
});

/** POST /notifications/read-all — mark every unread notification of the caller's read. */
router.post('/read-all', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) throw new HttpError(500, error.message);
    res.json({ success: true });
  } catch (err) {
    sendError(req, res, err);
  }
});

export default router;
