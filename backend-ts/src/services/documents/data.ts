/**
 * margixindia — Custody events and exception cases of a load, read for reports, the POD and the timeline.
 *
 * A load's goods are its manifest plus any lots split from it; custody events and exception items hang off those
 * manifests (cargo_custody_events.manifest_id, cargo_exception_items.manifest_id).
 */
import { supabase } from '../../core/supabase';
import type { LoadAccess } from './context';

export interface CustodyEvent {
  id: string;
  manifest_id: string | null;
  kind: string;
  pieces: number | null;
  weight_kg: number | null;
  condition: string | null;
  receiver_name: string | null;
  notes: string | null;
  photo_paths: string[] | null;
  signature_path: string | null;
  recorded_by: string | null;
  recorded_role: string | null;
  recorded_at: string;
}

export interface ExceptionCase {
  id: string;
  code: string | null;
  type: string;
  severity: string | null;
  status: string;
  description: string | null;
  owner_id: string | null;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
  items: Array<{ id: string; manifest_id: string | null; pieces_affected: number | null; weight_affected_kg: number | null; condition: string | null; note: string | null }>;
}

export const manifestIds = (access: LoadAccess): string[] => access.manifests.map(m => m.id as string);

/** Every custody event of the load's manifests (and lots), oldest first. */
export async function custodyEventsOf(access: LoadAccess): Promise<CustodyEvent[]> {
  const ids = manifestIds(access);
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from('cargo_custody_events')
    .select('id, manifest_id, kind, pieces, weight_kg, condition, receiver_name, notes, photo_paths, signature_path, recorded_by, recorded_role, recorded_at')
    .in('manifest_id', ids).order('recorded_at', { ascending: true });
  if (error) throw new Error(`Failed to read custody events: ${error.message}`);
  return (data ?? []) as CustodyEvent[];
}

/** The exception cases that touch the load's manifests, with their affected-goods items. */
export async function exceptionsOf(access: LoadAccess): Promise<ExceptionCase[]> {
  const ids = manifestIds(access);
  if (ids.length === 0) return [];
  const { data: items, error } = await supabase.from('cargo_exception_items')
    .select('id, exception_id, manifest_id, pieces_affected, weight_affected_kg, condition, note').in('manifest_id', ids);
  if (error) throw new Error(`Failed to read exception items: ${error.message}`);
  const exceptionIds = [...new Set((items ?? []).map((i: any) => i.exception_id as string))];
  if (exceptionIds.length === 0) return [];
  const { data: cases, error: cErr } = await supabase.from('cargo_exceptions')
    .select('id, code, type, severity, status, description, owner_id, resolution, created_at, resolved_at').in('id', exceptionIds).order('created_at', { ascending: true });
  if (cErr) throw new Error(`Failed to read exceptions: ${cErr.message}`);
  return ((cases ?? []) as any[]).map(c => ({ ...c, items: (items ?? []).filter((i: any) => i.exception_id === c.id) }));
}

export async function userNames(ids: Array<string | null | undefined>): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  const out = new Map<string, string | null>();
  if (unique.length === 0) return out;
  const { data } = await supabase.from('users').select('id, full_name').in('id', unique);
  for (const u of data ?? []) out.set((u as any).id, (u as any).full_name ?? null);
  return out;
}
