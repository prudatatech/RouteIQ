/**
 * margixindia — Audit trail for decisions people make in the console.
 *
 * Each entry is a row in `ai_agent_logs`, which the superadmin Audit Logs page
 * already lists (GET /analytics/audit-logs). `agent_name` says which console
 * acted; who acted and on what is kept in `input_data`.
 *
 * Writing the entry never blocks or undoes the action it describes: a failure
 * is logged and swallowed, like a failed notification.
 */
import crypto from 'crypto';
import { supabase } from '../core/supabase';

export type AuditConsole = 'staff-console' | 'vendor-portal' | 'partner-portal' | 'driver-app' | 'system';

export interface AuditActor {
  user_id: string;
  role: string;
}

export const auditService = {
  /** An action the system took by itself (the scheduler, an automatic rule). Shown on the audit page as source `system`. */
  async recordSystem(action: string, subject: Record<string, unknown>, outcome?: string): Promise<void> {
    await auditService.record('system', { user_id: 'system', role: 'system' }, action, subject, outcome);
  },

  async record(
    source: AuditConsole,
    actor: AuditActor,
    action: string,
    subject: Record<string, unknown>,
    outcome?: string,
  ): Promise<void> {
    try {
      const { error } = await supabase.from('ai_agent_logs').insert({
        id: crypto.randomUUID(),
        agent_name: source,
        action,
        input_data: { actor_id: actor.user_id, actor_role: actor.role, ...subject },
        output_data: outcome ?? null,
        status: 'success',
        vehicle_id: typeof subject.vehicle_id === 'string' ? subject.vehicle_id : null,
        route_id: typeof subject.route_id === 'string' ? subject.route_id : null,
      });
      if (error) console.error('[audit] could not record entry:', error.message);
    } catch (e) {
      console.error('[audit] could not record entry:', e);
    }
  },
};
