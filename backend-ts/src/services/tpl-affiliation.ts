/**
 * margixindia — A company's 3PL partners: who they are, and what the company allows of each (docs/network-design.md).
 *
 * A partner is an organisation of kind tpl_partner affiliated to a company (tpl_affiliations). The offers and orders
 * still key on the older tpl_partners row (its id is stored on the organisation as profile.legacy_tpl_partner_id),
 * so this module is the one place that maps between the two. `rules` on the affiliation limit what is offered:
 *
 *   { vehicle_classes?: string[], corridor_ids?: uuid[], min_rate_per_km?: number, gps_required?: boolean, insurance_required?: boolean }
 */
import { z } from 'zod';
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { isUuid } from '../core/validate';
import { indianDateKey } from '../core/istDate';
import type { CorridorRate } from '../utils/corridor-match';

/**
 * The shape of `rules`. A rule sent as null is cleared (it is left out of what is stored), so a form can switch one off.
 * A client may also send only the rules it wants set: the whole object is what the company allows.
 */
const RulesShape = z.object({
  vehicle_classes: z.array(z.string().trim().min(1, 'A vehicle class cannot be empty').max(40)).max(30, 'At most 30 vehicle classes').nullish(),
  corridor_ids: z.array(z.string().uuid('A lane id is not valid')).max(100, 'At most 100 lanes').nullish(),
  min_rate_per_km: z.number({ invalid_type_error: 'The minimum rate must be a number', required_error: 'The minimum rate must be a number' }).min(0, 'The minimum rate cannot be negative').max(10_000, 'The minimum rate is too high').nullish(),
  gps_required: z.boolean({ invalid_type_error: 'GPS required must be true or false', required_error: 'GPS required must be true or false' }).nullish(),
  insurance_required: z.boolean({ invalid_type_error: 'Insurance required must be true or false', required_error: 'Insurance required must be true or false' }).nullish(),
}).strict('Unknown rule');

export interface AffiliationRules {
  vehicle_classes?: string[];
  corridor_ids?: string[];
  min_rate_per_km?: number;
  gps_required?: boolean;
  insurance_required?: boolean;
}

export const AffiliationRulesSchema = RulesShape.transform((rules): AffiliationRules => {
  const out: AffiliationRules = {};
  if (rules.vehicle_classes) out.vehicle_classes = rules.vehicle_classes;
  if (rules.corridor_ids) out.corridor_ids = rules.corridor_ids;
  if (rules.min_rate_per_km != null) out.min_rate_per_km = rules.min_rate_per_km;
  if (rules.gps_required != null) out.gps_required = rules.gps_required;
  if (rules.insurance_required != null) out.insurance_required = rules.insurance_required;
  return out;
});

/** A partner of a company: the organisation, the legacy partner row id, and the company's rules for it. */
export interface AffiliatedPartner {
  orgId: string;
  partnerId: string | null;
  rules: AffiliationRules;
}

/** What is stored may predate a rule or be malformed: anything not understood is dropped, never trusted. */
export function readRules(raw: unknown): AffiliationRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: AffiliationRules = {};
  if (Array.isArray(r.vehicle_classes)) out.vehicle_classes = r.vehicle_classes.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  if (Array.isArray(r.corridor_ids)) out.corridor_ids = r.corridor_ids.filter((v): v is string => typeof v === 'string');
  if (typeof r.min_rate_per_km === 'number' && Number.isFinite(r.min_rate_per_km)) out.min_rate_per_km = r.min_rate_per_km;
  if (r.gps_required === true) out.gps_required = true;
  if (r.insurance_required === true) out.insurance_required = true;
  return out;
}

/** The active partners of a company (the affiliation is active and so is the partner organisation). */
export async function activePartnersOf(companyOrgId: string): Promise<AffiliatedPartner[]> {
  const { data: affiliations, error } = await supabase
    .from('tpl_affiliations').select('tpl_id, rules').eq('company_id', companyOrgId).eq('status', 'active');
  if (error) throw new Error(`Failed to load partners: ${error.message}`);
  if (!affiliations || affiliations.length === 0) return [];
  const { data: orgs, error: oErr } = await supabase
    .from('organizations').select('id, profile').in('id', affiliations.map(a => a.tpl_id)).eq('kind', 'tpl_partner').eq('status', 'active');
  if (oErr) throw new Error(`Failed to load partner organisations: ${oErr.message}`);
  const orgById = new Map((orgs ?? []).map(o => [o.id as string, o]));
  const out: AffiliatedPartner[] = [];
  for (const a of affiliations) {
    const org = orgById.get(a.tpl_id);
    if (!org) continue;
    const legacy = (org.profile as { legacy_tpl_partner_id?: unknown } | null)?.legacy_tpl_partner_id;
    out.push({ orgId: org.id, partnerId: typeof legacy === 'string' ? legacy : null, rules: readRules(a.rules) });
  }
  return out;
}

/** The ids of a company's active partner organisations. */
export async function activePartnerOrgIds(companyOrgId: string): Promise<string[]> {
  return (await activePartnersOf(companyOrgId)).map(p => p.orgId);
}

/** The partner organisation of a legacy tpl_partners id (null when it has none). */
export async function partnerOrgOf(partnerId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('organizations').select('id, profile').eq('kind', 'tpl_partner').contains('profile', { legacy_tpl_partner_id: partnerId });
  if (error) throw new Error(`Failed to load the partner organisation: ${error.message}`);
  const match = (data ?? []).find(o => (o.profile as { legacy_tpl_partner_id?: unknown } | null)?.legacy_tpl_partner_id === partnerId);
  return (match as { id: string } | undefined)?.id ?? null;
}

/** The legacy tpl_partners id of a partner organisation (null when it has none). */
export async function legacyPartnerIdOf(orgId: string): Promise<string | null> {
  const { data, error } = await supabase.from('organizations').select('profile').eq('id', orgId).eq('kind', 'tpl_partner').maybeSingle();
  if (error) throw new Error(`Failed to load the partner organisation: ${error.message}`);
  const legacy = (data?.profile as { legacy_tpl_partner_id?: unknown } | null)?.legacy_tpl_partner_id;
  return typeof legacy === 'string' ? legacy : null;
}

/**
 * The partner organisation a company means by `id`: the organisation itself when the company has an affiliation with
 * it, else the organisation of the older tpl_partners row with that id. A 404 when neither is the company's partner.
 */
export async function resolveTplOrg(companyOrgId: string, id: string): Promise<string> {
  if (!isUuid(id)) throw new HttpError(404, 'Partner not found');
  const { data, error } = await supabase.from('tpl_affiliations').select('tpl_id').eq('company_id', companyOrgId).eq('tpl_id', id).maybeSingle();
  if (error) throw new Error(`Failed to read the affiliation: ${error.message}`);
  if (data) return id;
  const org = await partnerOrgOf(id);
  if (!org) throw new HttpError(404, 'Partner not found');
  return org;
}

/** A 404 unless the partner organisation has a live (not ended) affiliation to the company. */
export async function assertAffiliated(companyOrgId: string, tplOrgId: string): Promise<{ status: string; rules: AffiliationRules }> {
  const { data, error } = await supabase
    .from('tpl_affiliations').select('status, rules').eq('company_id', companyOrgId).eq('tpl_id', tplOrgId).maybeSingle();
  if (error) throw new Error(`Failed to read the affiliation: ${error.message}`);
  if (!data || data.status === 'ended') throw new HttpError(404, 'Partner not found');
  return { status: data.status, rules: readRules(data.rules) };
}

// ── Rules ────────────────────────────────────────────────────────────

export interface FleetFlags {
  /** At least one vehicle with a GPS device. */
  gps: boolean;
  /** At least one vehicle whose insurance number is filled in and not expired. */
  insured: boolean;
}

/** What a partner's vehicles show for the GPS and insurance rules, by partner organisation. */
export async function fleetFlagsOf(orgIds: string[]): Promise<Map<string, FleetFlags>> {
  const out = new Map<string, FleetFlags>(orgIds.map(id => [id, { gps: false, insured: false }]));
  if (orgIds.length === 0) return out;
  const { data, error } = await supabase
    .from('vehicles').select('id, carrier_org_id, spark_id, insurance_number, insurance_expiry, status').in('carrier_org_id', orgIds);
  if (error) throw new Error(`Failed to load partner vehicles: ${error.message}`);
  const today = indianDateKey(new Date());
  for (const v of data ?? []) {
    if (v.status === 'archived') continue;
    const flags = out.get(v.carrier_org_id as string);
    if (!flags) continue;
    if (v.spark_id) flags.gps = true;
    const expiry = typeof v.insurance_expiry === 'string' ? v.insurance_expiry.slice(0, 10) : null;
    if (v.insurance_number && (!expiry || expiry >= today)) flags.insured = true;
  }
  return out;
}

export interface RuleContext {
  vehicleClass: string | null;
  distanceKm: number | null;
  /** The partner's matched corridor rate and the price it gives for this load. */
  rate: CorridorRate | null;
  price: number | null;
  fleet: FleetFlags | null;
}

/** The reason a partner is left out by the company's rules, or null when the rules allow it. */
export function ruleExclusion(rules: AffiliationRules, ctx: RuleContext): string | null {
  const classes = (rules.vehicle_classes ?? []).map(c => c.trim().toLowerCase()).filter(Boolean);
  if (classes.length > 0 && ctx.vehicleClass && !classes.includes(ctx.vehicleClass.trim().toLowerCase())) {
    return `Your rules do not allow the ${ctx.vehicleClass} vehicle class for this partner`;
  }
  if (rules.min_rate_per_km != null && rules.min_rate_per_km > 0) {
    const perKm = ctx.rate?.unit === 'per_km'
      ? ctx.rate.amount
      : ctx.price != null && ctx.distanceKm != null && ctx.distanceKm > 0 ? ctx.price / ctx.distanceKm : null;
    if (perKm != null && perKm < rules.min_rate_per_km) {
      return `Rate of ₹${(Math.round(perKm * 100) / 100).toLocaleString('en-IN')} per km is below your minimum of ₹${rules.min_rate_per_km.toLocaleString('en-IN')} per km`;
    }
  }
  if (rules.gps_required && ctx.fleet && !ctx.fleet.gps) return 'Your rules need a GPS-tracked vehicle and this partner has none';
  if (rules.insurance_required && ctx.fleet && !ctx.fleet.insured) return 'Your rules need a vehicle with valid insurance and this partner has none';
  return null;
}
