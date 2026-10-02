/**
 * margixindia — User Routes
 * Ports: backend/app/api/v1/endpoints/users.py
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { mayGrantSuperadmin } from '../core/org-context';
import { invalidateRoleCache, requireAuth, requireRole } from '../core/auth';
import { UserUpdateSchema } from '../schemas';
import { HttpError, sendError } from '../core/errors';
import { auditService } from '../services/audit.service';
import { memberOrgId } from '../core/org-scope';
import { isInActiveOrg } from '../services/people-common';

const router = Router();

// ── GET /me ────────────────────────────────────────────────
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, full_name, role, is_active, created_at')
      .eq('id', req.user!.user_id)
      .single();

    if (error || !user) {
      res.status(404).json({ detail: 'User not found' });
      return;
    }
    // `role` stays what the account was created as; `effective_role` is what the active organisation grants
    res.json({
      ...user,
      effective_role: req.user!.role,
      org: req.org ? { id: req.org.id, kind: req.org.kind, name: req.org.name, status: req.org.status, role: req.orgRole } : null,
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── PUT /language ──────────────────────────────────────────────
router.put('/language', requireAuth, async (req: Request, res: Response) => {
  try {
    const { language } = req.body;
    if (!language || !['en', 'hi', 'mr'].includes(language)) {
      res.status(400).json({ detail: 'Invalid language code' });
      return;
    }

    const { error } = await supabase.auth.admin.updateUserById(req.user!.user_id, {
      user_metadata: { language_preference: language }
    });

    if (error) {
      console.error('[USERS API] Error updating language:', error.message);
      res.status(500).json({ detail: 'Failed to update language' });
      return;
    }

    res.json({ status: 'success', language });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET / ──────────────────────────────────────────────────
router.get('/', requireAuth, requireRole('admin', 'superadmin'), async (req: Request, res: Response) => {
  try {
    // A company sees its own members; the platform and a single-company setup see everyone
    const orgId = memberOrgId();
    let usersQuery = supabase
      .from('users')
      .select(orgId ? 'id, email, full_name, role, is_active, created_at, org_members!inner(org_id, status)' : 'id, email, full_name, role, is_active, created_at');
    if (orgId) usersQuery = usersQuery.eq('org_members.org_id', orgId).eq('org_members.status', 'active');
    const { data: rawUsers, error } = await usersQuery;

    if (error) throw error;
    const users = (rawUsers ?? []).map(({ org_members: _m, ...u }: any) => u);

    // Fetch ALL vendor profiles
    const { data: profiles } = await supabase
      .from('vendor_profiles')
      .select('id, company_name, city, address, gst_number, created_at, is_verified');

    let profilesMap: Record<string, any> = {};
    if (profiles) {
      profiles.forEach(p => {
        profilesMap[p.id] = [p]; // Frontend expects an array
      });
    }

    const mergedUsers = users?.map(u => ({
      ...u,
      vendor_profiles: profilesMap[u.id] || null
    })) || [];

    // Add any vendors that exist in vendor_profiles but NOT in the public.users table
    if (profiles && !orgId) {
      const existingUserIds = new Set(mergedUsers.map(u => u.id));
      profiles.forEach(p => {
        if (!existingUserIds.has(p.id)) {
          mergedUsers.push({
            id: p.id,
            email: '(Vendor Signup)',
            full_name: p.company_name,
            role: 'vendor',
            is_active: p.is_verified || false,
            created_at: p.created_at || new Date().toISOString(),
            vendor_profiles: [p]
          });
        }
      });
    }

    res.json(mergedUsers);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── PATCH /:user_id ────────────────────────────────────────
router.patch('/:user_id', requireAuth, requireRole('admin', 'superadmin'), async (req: Request, res: Response) => {
  try {
    const { user_id } = req.params;
    const parsed = UserUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: parsed.error.issues[0].message });
      return;
    }

    // Filter undefined values
    const updateData: Record<string, any> = {};
    const payload = parsed.data;
    if (payload.full_name !== undefined) updateData.full_name = payload.full_name;
    if (payload.role !== undefined) updateData.role = payload.role;
    if (payload.is_active !== undefined) updateData.is_active = payload.is_active;

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ detail: 'No fields to update' });
      return;
    }

    // Nobody changes their own role or switches themselves off: that is how the last admin locks everyone out
    if (user_id === req.user!.user_id && (payload.role !== undefined || payload.is_active !== undefined)) {
      throw new HttpError(409, "You can't change your own role or deactivate your own account. Ask another admin.");
    }

    // Check if user exists in public.users
    const { data: existingUser } = await supabase.from('users').select('id, role, status').eq('id', user_id).maybeSingle();
    // Another company's person (or vendor) is the same 404 as a missing one
    if (memberOrgId() && user_id !== req.user!.user_id && !(existingUser && (await isInActiveOrg(user_id)))) {
      throw new HttpError(404, 'User not found');
    }

    // Only a superadmin may grant privileged roles or modify privileged accounts
    const privileged = ['admin', 'superadmin'];
    if (req.user!.role !== 'superadmin'
      && ((payload.role && privileged.includes(payload.role)) || (existingUser && privileged.includes(existingUser.role)))) {
      res.status(403).json({ detail: 'Only a superadmin can change admin accounts or grant admin roles' });
      return;
    }

    // Only a superadmin changes roles, and never between driver and staff on the same record
    if (existingUser && payload.role !== undefined && payload.role !== existingUser.role) {
      if (req.user!.role !== 'superadmin') throw new HttpError(403, 'Only a superadmin can change a role');
      if ((payload.role === 'superadmin' || existingUser.role === 'superadmin') && !mayGrantSuperadmin(req.user!.role)) {
        throw new HttpError(403, 'Only the platform can grant or change a superadmin');
      }
      if ((payload.role === 'driver') !== (existingUser.role === 'driver')) {
        throw new HttpError(409, "A driver can't be turned into staff, or the reverse, on the same record. Create a new person instead");
      }
    }
    // users.status follows is_active (people profiles): off means suspended, on means active again
    if (existingUser && payload.is_active !== undefined) {
      const signsIn = ['onboarding', 'active', 'on_leave'].includes(String(existingUser.status));
      if (payload.is_active && !signsIn) updateData.status = 'active';
      if (!payload.is_active && signsIn) updateData.status = 'suspended';
    }

    let updateError;
    if (!existingUser) {
      // It's a vendor that only exists in vendor_profiles. Bypass public.users entirely
      // to avoid Postgres user_role enum errors. Map is_active -> is_verified.
      if (payload.is_active !== undefined) {
        const { error } = await supabase.from('vendor_profiles').update({ is_verified: payload.is_active }).eq('id', user_id);
        updateError = error;
      }
    } else {
      const { error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', user_id);
      updateError = error;
    }

    if (updateError) throw updateError;

    if (existingUser && payload.role !== undefined) {
      // Keep the server-controlled auth role in step with public.users
      const { error: authErr } = await supabase.auth.admin.updateUserById(user_id, { app_metadata: { role: payload.role } });
      if (authErr) console.error(`[users] Failed to sync app_metadata role for ${user_id}: ${authErr.message}`);
    }
    invalidateRoleCache(user_id);
    await auditService.record('staff-console', req.user!, 'user_updated', { user_id, changes: updateData, previous_role: existingUser?.role ?? null });

    let finalUser;
    if (!existingUser) {
      // Re-fetch the vendor profile to return a synthetic user
      const { data: vProfile } = await supabase.from('vendor_profiles').select('*').eq('id', user_id).single();
      finalUser = {
        id: user_id,
        email: '(Vendor Signup)',
        full_name: vProfile?.company_name || 'Vendor',
        role: 'vendor',
        is_active: vProfile?.is_verified || false,
        created_at: vProfile?.created_at || new Date().toISOString()
      };
    } else {
      const { data: user, error: fetchError } = await supabase
        .from('users')
        .select('id, email, full_name, role, is_active, created_at')
        .eq('id', user_id)
        .single();
      finalUser = user;
    }

    res.json(finalUser);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

export default router;
