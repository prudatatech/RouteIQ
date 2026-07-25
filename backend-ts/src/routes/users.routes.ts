/**
 * RouteIQ — User Routes
 * Ports: backend/app/api/v1/endpoints/users.py
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth, requireRole } from '../core/auth';
import { UserUpdateSchema } from '../schemas';

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
    res.json(user);
  } catch (e: any) {
    console.error('[USERS API ERROR]:', e);
    res.status(500).json({ detail: e.message });
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
    console.error('[USERS API ERROR]:', e);
    res.status(500).json({ detail: e.message });
  }
});

// ── GET / ──────────────────────────────────────────────────
router.get('/', requireAuth, requireRole('admin', 'superadmin'), async (_req: Request, res: Response) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, full_name, role, is_active, created_at');

    if (error) {
      res.status(500).json({ detail: error.message });
      return;
    }

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
    if (profiles) {
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
    console.error('[USERS API GET ERROR]:', e);
    res.status(500).json({ detail: e.message });
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

    // Check if user exists in public.users
    const { data: existingUser } = await supabase.from('users').select('id').eq('id', user_id).single();
    
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

    if (updateError) {
      res.status(500).json({ detail: updateError.message });
      return;
    }

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
    res.status(500).json({ detail: e.message });
  }
});

export default router;
