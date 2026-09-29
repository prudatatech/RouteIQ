import { supabase } from '../core/supabase';
import { pushService } from './push.service';

/** Notification types managers receive too: the day-to-day work they act on. */
export const OPERATIONS_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  'sos', 'stop_failed', 'fleet_alert', 'vendor_request', 'customer_booking', 'capacity_bid', 'route_postponed', 'document_expiring',
]);

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
   * who can acknowledge and resolve them. Anything else (KYC, 3PL partner
   * applications) goes to admin and superadmin only. Deactivated accounts
   * are excluded.
   */
  async notifyStaff(title: string, body: string, type: string, data: any = {}) {
    const roles = OPERATIONS_NOTIFICATION_TYPES.has(type) ? ['admin', 'superadmin', 'manager'] : ['admin', 'superadmin'];
    const { data: staff, error } = await supabase
      .from('users')
      .select('id')
      .in('role', roles)
      .eq('is_active', true);

    if (error || !staff) return;

    for (const member of staff) {
      await this.sendNotification(member.id, title, body, type, data);
    }
  }
};
