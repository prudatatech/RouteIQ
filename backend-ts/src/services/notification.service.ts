import { supabase } from '../core/supabase';
import { pushService } from './push.service';
import { currentOrgContext } from '../core/org-context';

/**
 * Notification types managers receive too: the day-to-day work they act on. Only types that open a page
 * a manager may use are here (bids are decided by admin, so capacity_bid is not).
 */
export const OPERATIONS_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  'sos', 'stop_failed', 'fleet_alert', 'vendor_request', 'customer_booking', 'route_postponed', 'document_expiring', 'stop_prompts_released', 'vehicle_request',
  // Cargo cases, transfers, returns, hubs and claims (docs/cargo-plan.md); cargo_delivery_otp goes to customers only
  'cargo_exception_opened', 'cargo_exception_escalated', 'cargo_exception_resolved', 'cargo_transfer_planned', 'cargo_transfer_completed',
  'cargo_partial_delivery', 'cargo_rto_started', 'cargo_at_hub', 'cargo_claim_update', 'driver_action_rejected',
  // Workflow handoffs (docs/notifications.md)
  'driver_signed_up', 'driver_needs_vehicle', 'document_uploaded', 'delivery_rated',
]);

/** How long a repeated notification (same person, type and key) is treated as a duplicate. */
export const DEDUPE_HOURS = 24;

/** The staff who hear about something of `orgId`'s (see notifyStaff), as user ids. */
export const PLATFORM = 'platform' as const;

export async function staffToNotify(type: string, orgId?: string | null | typeof PLATFORM): Promise<string[]> {
  const roles = OPERATIONS_NOTIFICATION_TYPES.has(type) ? ['admin', 'superadmin', 'manager'] : ['admin', 'superadmin'];
  // News for the platform itself (a 3PL application, a vendor's KYC): only the platform's owners and admins
  const platformOnly = orgId === PLATFORM;
  let company = platformOnly ? null : orgId ?? null;
  if (!company && !platformOnly) {
    const org = currentOrgContext()?.org;
    if (org && org.kind === 'logistic_company') company = org.id;
  }
  let limitTo: string[] | null = null;
  if (company || platformOnly) {
    const ids = new Set<string>();
    if (company) {
      const { data: members, error: mErr } = await supabase.from('org_members').select('user_id').eq('org_id', company).eq('status', 'active');
      if (mErr) throw new Error(`Failed to read members: ${mErr.message}`);
      for (const m of members ?? []) ids.add((m as { user_id: string }).user_id);
    }
    // The platform's own owners and admins hear about every company
    const { data: platform, error: pErr } = await supabase.from('organizations').select('id').eq('kind', 'platform');
    if (pErr) throw new Error(`Failed to read organisations: ${pErr.message}`);
    const platformIds = (platform ?? []).map((o: { id: string }) => o.id);
    if (platformIds.length > 0) {
      const { data: admins, error: aErr } = await supabase.from('org_members').select('user_id').in('org_id', platformIds).in('role', ['owner', 'admin']).eq('status', 'active');
      if (aErr) throw new Error(`Failed to read members: ${aErr.message}`);
      for (const a of admins ?? []) ids.add((a as { user_id: string }).user_id);
    }
    // Organisations are not set up (no platform organisation): everyone is told, as before
    if (platformOnly && platformIds.length === 0) limitTo = null;
    else {
      limitTo = [...ids];
      if (limitTo.length === 0) return [];
    }
  }
  let q = supabase.from('users').select('id').in('role', roles).eq('is_active', true);
  if (limitTo) q = q.in('id', limitTo);
  const { data: staff, error } = await q;
  if (error || !staff) return [];
  return staff.map((u: { id: string }) => u.id);
}

export const notificationService = {
  /**
   * Send an in-app notification to a user (driver, admin, or vendor)
   */
  async sendNotification(userId: string, title: string, body: string, type: string, data: any = {}) {
    const { data: notif, error } = await supabase.from('notifications').insert({
      user_id: userId,
      title,
      body,
      type,
      data
    }).select().single();

    if (error) {
      console.error('Error sending notification:', error);
      throw new Error(error.message);
    }
    
    // Also trigger native Push Notification if they are a driver. The type
    // travels with it so a tap opens the right screen (e.g. Messages).
    await pushService.sendToUser(userId, title, body, { ...(data ?? {}), type });

    return notif;
  },

  /**
   * Like sendNotification, but not when this person already got a notification of this type with the
   * same value under `data[key]` in the last DEDUPE_HOURS. For triggers that can fire twice (a scheduler
   * pass, a retried request). Returns null when it was a duplicate.
   */
  async sendNotificationOnce(userId: string, title: string, body: string, type: string, data: Record<string, unknown>, key: string, hours = DEDUPE_HOURS) {
    const since = new Date(Date.now() - hours * 3600_000).toISOString();
    const { data: recent } = await supabase
      .from('notifications').select('id, data').eq('user_id', userId).eq('type', type).gte('created_at', since);
    if ((recent ?? []).some((r: any) => r.data?.[key] === data[key])) return null;
    return this.sendNotification(userId, title, body, type, data);
  },

  /** notifyStaff with the same duplicate check as sendNotificationOnce, per staff member. */
  async notifyStaffOnce(title: string, body: string, type: string, data: Record<string, unknown>, key: string, hours = DEDUPE_HOURS, orgId?: string | null | typeof PLATFORM) {
    const staff = await staffToNotify(type, orgId);
    for (const id of staff) {
      await this.sendNotificationOnce(id, title, body, type, data, key, hours);
    }
  },

  /**
   * Notify super admins (e.g. for a new vendor shipment request)
   */
  async notifySuperAdmins(title: string, body: string, type: string, data: any = {}) {
    // Find all super admins
    const { data: admins, error } = await supabase.from('users').select('id').eq('role', 'superadmin');

    if (error || !admins) return;

    for (const admin of admins) {
      await this.sendNotification(admin.id, title, body, type, data);
    }
  },

  /**
   * Notify active staff about something that needs attention (a new SOS,
   * a vendor shipment request, a bid waiting for a decision, ...).
   *
   * Operational types (OPERATIONS_NOTIFICATION_TYPES) also reach managers,
   * who can acknowledge and resolve them. KYC goes to admin and superadmin;
   * 3PL partner applications and orders (tpl_*) go to superadmin only. Deactivated accounts
   * are excluded.
   *
   * `orgId` is the company that owns the record the news is about: only that company's members hear it,
   * plus the platform's owners and admins. Without it the company of the request being handled is used;
   * with neither (the scheduler, before organisations are set up) every staff member is told, as before.
   * `PLATFORM` is for news about the platform itself: only its owners and admins hear it.
   */
  async notifyStaff(title: string, body: string, type: string, data: any = {}, orgId?: string | null | typeof PLATFORM) {
    const staff = await staffToNotify(type, orgId);
    for (const id of staff) {
      await this.sendNotification(id, title, body, type, data);
    }
  }
};
