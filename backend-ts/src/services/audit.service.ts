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
import { currentOrgContext } from '../core/org-context';
import { OWNED, memberOrgId, scopeQuery } from '../core/org-scope';
import { isUuid } from '../core/validate';

export type AuditConsole = 'staff-console' | 'vendor-portal' | 'partner-portal' | 'driver-app' | 'system';

export interface AuditActor {
  user_id: string;
  role: string;
}

type LogRow = { vehicle_id?: string | null; route_id?: string | null; input_data?: any };

/**
 * The entries a company may see: those it made (stamped with its organisation), and older ones about its own
 * vehicles or trips or by its own members. The audit table has no owner column, so this reads each entry's own
 * references rather than adding one. A platform admin acting as the platform, and a setup with no organisations
 * yet, see everything.
 */
export async function auditEntriesForOrg<T extends LogRow>(rows: T[]): Promise<T[]> {
  const orgId = memberOrgId();
  if (!orgId) return rows;
  const idsOf = (get: (r: T) => unknown) => [...new Set(rows.map(get).filter(isUuid))];
  const people = (r: T) => [r.input_data?.actor_id, r.input_data?.user_id];
  const [vehicles, trips, members] = await Promise.all([
    chunked(idsOf(r => r.vehicle_id), ids => supabase.from('vehicles').select('id').in('id', ids), OWNED.carrier),
    chunked(idsOf(r => r.route_id), ids => supabase.from('routes').select('id').in('id', ids), OWNED.carrier),
    chunked([...new Set(rows.flatMap(people).filter(isUuid))], ids => supabase.from('org_members').select('user_id').eq('org_id', orgId).eq('status', 'active').in('user_id', ids), null),
  ]);
  return rows.filter(r => {
    const stamped = r.input_data?.org_id;
    if (stamped) return stamped === orgId;
    return (isUuid(r.vehicle_id) && vehicles.has(r.vehicle_id)) || (isUuid(r.route_id) && trips.has(r.route_id))
      || people(r).some(p => isUuid(p) && members.has(p));
  });
}

async function chunked(ids: string[], read: (chunk: string[]) => any, cols: typeof OWNED.carrier | null): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const query = read(ids.slice(i, i + 100));
    const { data, error } = await (cols ? scopeQuery(query, cols) : query);
    if (error) throw new Error(`Failed to check audit entries: ${error.message}`);
    for (const r of data ?? []) out.add((r.id ?? r.user_id) as string);
  }
  return out;
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
        // The organisation the actor acted for, so a company can be shown its own entries
        input_data: { actor_id: actor.user_id, actor_role: actor.role, ...(currentOrgContext()?.org ? { org_id: currentOrgContext()!.org!.id } : {}), ...subject },
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
