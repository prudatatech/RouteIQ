/**
 * margixindia — The dispatch block on missing documents.
 *
 * The pre-dispatch checklist (checklist.ts) always warns. When the carrier company has turned on
 * `dispatch_block_on_missing_docs`, the goods may not leave until nothing is missing, expired or inconsistent.
 * This is the one guard; it is called at the one moment a vendor load leaves: the driver completing the pickup.
 */
import { supabase } from '../../core/supabase';
import { HttpError } from '../../core/errors';
import { blocksOnMissingDocs, dispatchCheck, ISSUE_STATUSES } from './checklist';
import { mainManifest, type LoadAccess } from './context';
import type { DocumentRow } from './documents.service';

/**
 * Refuses (409, listing what is wrong) when the load's carrier blocks dispatch on missing documents and the
 * checklist has issues. With the setting off, or a clean checklist, it returns and dispatch goes ahead.
 */
export async function assertDispatchReady(loadId: string): Promise<void> {
  const { data: load, error } = await supabase.from('vendor_shipment_requests').select('*').eq('id', loadId).maybeSingle();
  if (error) throw new Error(`Failed to read the load: ${error.message}`);
  if (!load) return;
  const { data: manifests, error: mErr } = await supabase.from('cargo_manifest').select('*').eq('vendor_request_id', loadId);
  if (mErr) throw new Error(`Failed to read the load's manifests: ${mErr.message}`);
  const list = (manifests ?? []) as Record<string, any>[];
  const main = mainManifest(list);
  const vehicleId: string | null = main?.current_vehicle_id ?? main?.vehicle_id ?? load.assigned_vehicle_id ?? null;

  let carrierOrgId: string | null = (load.carrier_org_id as string | undefined) ?? main?.carrier_org_id ?? null;
  if (!carrierOrgId && vehicleId) {
    const { data: v } = await supabase.from('vehicles').select('carrier_org_id').eq('id', vehicleId).maybeSingle();
    carrierOrgId = (v as { carrier_org_id?: string | null } | null)?.carrier_org_id ?? null;
  }
  // Cheap check first: with the setting off, nothing else is read
  if (!(await blocksOnMissingDocs(carrierOrgId))) return;

  const access: LoadAccess = {
    load, viewer: 'carrier', manifests: list, main, vehicleId, carrierOrgId,
    vendorOrgId: (load.vendor_org_id as string | null) ?? main?.vendor_org_id ?? null,
    userId: '',
  };
  const { data: docs, error: dErr } = await supabase.from('load_documents').select('*').eq('load_id', loadId);
  if (dErr) throw new Error(`Failed to read documents: ${dErr.message}`);
  const check = await dispatchCheck(access, (docs ?? []) as DocumentRow[]);
  if (check.can_dispatch) return;

  const problems = check.items.filter(i => ISSUE_STATUSES.includes(i.status));
  throw new HttpError(409, `This load cannot leave yet. Your company blocks dispatch until the documents are in order: ${problems.map(i => `${i.label} (${i.message})`).join('; ')}`);
}
