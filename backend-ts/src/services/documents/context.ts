/**
 * margixindia — A vendor load as the documents see it, and who may act on it.
 *
 * "Load" is a vendor_shipment_requests row. The logistic company running it is the load's carrier_org_id, set when the
 * vendor accepts its quote or it accepts directly (docs/order-routing.md), so it can generate the LR before a truck is
 * assigned. Older loads fall back to the carrying manifest's carrier_org_id, then the assigned vehicle's company.
 * Once a truck is assigned a cargo_manifest (vendor_request_id) carries the load.
 * Access is by organisation: the vendor organisation that posted the load, the carrier organisation running it,
 * and platform admins. Anyone else gets a 404, never a 403, so ids cannot be probed.
 */
import type { Request } from 'express';
import { supabase } from '../../core/supabase';
import { HttpError } from '../../core/errors';
import { uuidParam } from '../../core/validate';
import { currentOrgContext } from '../../core/org-context';

export type Viewer = 'vendor' | 'carrier' | 'platform';

export interface LoadAccess {
  load: Record<string, any>;
  viewer: Viewer;
  vendorOrgId: string | null;
  carrierOrgId: string | null;
  manifests: Record<string, any>[];
  /** The load itself, not a lot of it: a plain manifest or the master of a split one. */
  main: Record<string, any> | null;
  vehicleId: string | null;
  /** The acting user. */
  userId: string;
}

const NOT_FOUND = 'Load not found';

/** The load's own manifest: not a lot, not cancelled, the newest. */
export function mainManifest(manifests: Record<string, any>[]): Record<string, any> | null {
  const own = manifests.filter(m => !m.parent_manifest_id);
  const live = own.filter(m => m.status !== 'cancelled').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return live[0] ?? own[0] ?? null;
}

function viewerFor(req: Request, load: Record<string, any>, carrierOrgId: string | null): Viewer | null {
  const ctx = currentOrgContext();
  const org = req.org;
  if (ctx?.configured) {
    if (org?.kind === 'vendor' && load.vendor_org_id && org.id === load.vendor_org_id) return 'vendor';
    if (org && (org.kind === 'logistic_company' || org.kind === 'tpl_partner') && carrierOrgId && org.id === carrierOrgId) return 'carrier';
    return req.isPlatformAdmin ? 'platform' : null;
  }
  // Organisations are not set up yet: the account's own role decides
  const role = req.user?.role;
  if (role === 'superadmin' || role === 'admin' || role === 'manager') return 'carrier';
  if (role === 'vendor' && load.vendor_id === req.user?.user_id) return 'vendor';
  return null;
}

/** The load with its manifests and the caller's side of it, or a 404 when the caller is not on it. */
export async function resolveLoadAccess(req: Request, rawId: unknown): Promise<LoadAccess> {
  const id = uuidParam(rawId, NOT_FOUND);
  const { data: load, error } = await supabase.from('vendor_shipment_requests').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to read the load: ${error.message}`);
  if (!load) throw new HttpError(404, NOT_FOUND);
  const { data: manifests, error: mErr } = await supabase.from('cargo_manifest').select('*').eq('vendor_request_id', id);
  if (mErr) throw new Error(`Failed to read the load's manifests: ${mErr.message}`);
  const list = (manifests ?? []) as Record<string, any>[];
  const main = mainManifest(list);
  const vehicleId: string | null = main?.current_vehicle_id ?? main?.vehicle_id ?? load.assigned_vehicle_id ?? null;

  let carrierOrgId: string | null = (load.carrier_org_id as string | undefined) ?? main?.carrier_org_id ?? null;
  if (!carrierOrgId && vehicleId) {
    const { data: v } = await supabase.from('vehicles').select('carrier_org_id').eq('id', vehicleId).maybeSingle();
    carrierOrgId = (v as { carrier_org_id?: string | null } | null)?.carrier_org_id ?? null;
  }
  const viewer = viewerFor(req, load, carrierOrgId);
  if (!viewer) throw new HttpError(404, NOT_FOUND);
  return {
    load, viewer, manifests: list, main, vehicleId, carrierOrgId,
    vendorOrgId: (load.vendor_org_id as string | null) ?? main?.vendor_org_id ?? null,
    userId: req.user!.user_id,
  };
}

/** Only the carrier organisation may do this. A platform admin or the vendor sees the load, so it is a 403. */
export function requireCarrier(access: LoadAccess): void {
  if (access.viewer !== 'carrier') throw new HttpError(403, 'Only the carrying logistic company can do this');
}

/** Whether a transporter has accepted the load: it is priced and a company runs it. */
export function transporterAccepted(access: Pick<LoadAccess, 'load' | 'carrierOrgId'>): boolean {
  return !!access.carrierOrgId && ['approved', 'assigned', 'assigned_to_partner', 'completed', 'fulfilled'].includes(String(access.load.status));
}

export interface OrgInfo {
  id: string;
  name: string | null;
  legal_name: string | null;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  profile: Record<string, any>;
}

export interface LoadFacts {
  vendorOrg: OrgInfo | null;
  carrierOrg: OrgInfo | null;
  vehicle: Record<string, any> | null;
  driver: { id: string; name: string | null; phone: string | null } | null;
}

async function orgInfo(id: string | null): Promise<OrgInfo | null> {
  if (!id) return null;
  const { data, error } = await supabase.from('organizations').select('id, name, legal_name, gstin, address, city, state, pincode, phone, profile').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to read the organisation: ${error.message}`);
  if (!data) return null;
  return { ...(data as unknown as OrgInfo), profile: (data as any).profile && typeof (data as any).profile === 'object' ? (data as any).profile : {} };
}

/** The organisations, vehicle and driver behind a load. */
export async function loadFacts(access: LoadAccess): Promise<LoadFacts> {
  const [vendorOrg, carrierOrg, vehicleRes] = await Promise.all([
    orgInfo(access.vendorOrgId),
    orgInfo(access.carrierOrgId),
    access.vehicleId ? supabase.from('vehicles').select('*').eq('id', access.vehicleId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (vehicleRes.error) throw new Error(`Failed to read the vehicle: ${vehicleRes.error.message}`);
  const vehicle = (vehicleRes.data as Record<string, any> | null) ?? null;
  let driver: LoadFacts['driver'] = null;
  if (vehicle?.driver_id) {
    const { data: u } = await supabase.from('users').select('id, full_name, phone').eq('id', vehicle.driver_id).maybeSingle();
    driver = { id: vehicle.driver_id, name: (u as any)?.full_name ?? vehicle.driver_name ?? null, phone: (u as any)?.phone ?? vehicle.driver_phone ?? null };
  } else if (vehicle?.driver_name) {
    driver = { id: '', name: vehicle.driver_name, phone: vehicle.driver_phone ?? null };
  }
  return { vendorOrg, carrierOrg, vehicle, driver };
}

/** The number a load goes by: its load number once the posting migration has run, else the VR- code the apps use. */
export const loadCode = (load: Record<string, any>): string =>
  typeof load.load_number === 'string' && load.load_number ? load.load_number : `VR-${String(load.id).substring(0, 8).toUpperCase()}`;
