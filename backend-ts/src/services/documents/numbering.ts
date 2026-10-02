/**
 * margixindia — LR and freight sheet numbers: <prefix>-YYYY-NNNNN, one sequence per company, prefix and year.
 *
 * The sequence comes from the database (public.next_lr_number, an atomic upsert on lr_counters), so two documents
 * issued at once never share a number. The prefix is the company's `profile.lr_prefix` (letters and digits), else
 * LR; freight sheets use FS.
 */
import { supabase } from '../../core/supabase';
import { indianDateKey } from '../../core/istDate';
import type { OrgInfo } from './context';

export const FREIGHT_SHEET_PREFIX = 'FS';
const PREFIX = /^[A-Z0-9]{1,8}$/;

/** The company's LR prefix: `profile.lr_prefix` when it is valid, else LR. */
export function lrPrefixOf(org: Pick<OrgInfo, 'profile'> | null): string {
  const raw = org?.profile?.lr_prefix;
  const prefix = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return PREFIX.test(prefix) ? prefix : 'LR';
}

/** "LR-2026-00007". */
export function formatLrNumber(prefix: string, year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(5, '0')}`;
}

/** The next number of a company's sequence for the Indian calendar year. */
export async function nextDocumentNumber(orgId: string, prefix: string, now = new Date()): Promise<string> {
  const year = Number(indianDateKey(now).slice(0, 4));
  const { data, error } = await supabase.rpc('next_lr_number', { p_org: orgId, p_prefix: prefix, p_year: year });
  if (error) throw new Error(`Failed to number the document: ${error.message}`);
  const seq = Number(data);
  if (!Number.isInteger(seq) || seq < 1) throw new Error('The document counter returned no number');
  return formatLrNumber(prefix, year, seq);
}
