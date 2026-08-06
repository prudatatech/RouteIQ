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
    
    // Also trigger native Push Notification if they are a driver
    await pushService.sendToUser(userId, title, body, data);

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
  }
};
