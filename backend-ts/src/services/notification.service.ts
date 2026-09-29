import { supabase } from '../core/supabase';
import { pushService } from './push.service';

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
   * Notify every active staff member (admin and superadmin) — e.g. a new SOS,
   * a new vendor shipment request, a bid waiting for a decision, KYC
   * submitted, or a 3PL application submitted (see docs/ux-plan-2.md, D2).
   * Unlike `notifySuperAdmins`, this also reaches plain `admin` accounts and
   * excludes any account that has been deactivated.
   */
  async notifyStaff(title: string, body: string, type: string, data: any = {}) {
    const { data: staff, error } = await supabase
      .from('users')
      .select('id')
      .in('role', ['admin', 'superadmin'])
      .eq('is_active', true);

    if (error || !staff) return;

    for (const member of staff) {
      await this.sendNotification(member.id, title, body, type, data);
    }
  }
};
