/**
 * margixindia — Pre-dispatch checklist (PRD Appendix A3/A5).
 *
 * The documents a movement needs are conditional, never all-or-nothing:
 *   invoice or challan    always
 *   e-way bill            when the goods need one: the load says so, they are hazardous, or their declared value is
 *                         over the threshold (Rs 50,000)
 *   LR                    once a logistic company has accepted the load
 *   vehicle documents     RC, insurance, fitness and PUC (permit when on record) of the assigned vehicle, from `vehicles`
 *   driver licence        of the driver on that vehicle
 * Each item is ok, expiring (still valid, within 15 days), missing, expired or inconsistent (the e-way bill names
 * another vehicle than the one assigned). Missing, expired and inconsistent are issues. Dispatch shows them as a
 * warning; they stop dispatch only when the company has turned on `dispatch_block_on_missing_docs`.
 * The rules are pure (evaluateChecklist) so they are tested on their own; this file reads the data around them.
 */
import { supabase } from '../../core/supabase';
import { indianDateKey } from '../../core/istDate';
import { readEffectiveSetting } from '../company-settings.service';
import { getPeopleSettings } from '../people-settings.service';
import { licenceClassProblem, licenceInfo, daysBetween, type DocRow, type LicenceInfo } from '../people-docs.service';
import { INVOICE_KINDS, normalisePlate, DOC_LABELS } from './kinds';
import { loadFacts, transporterAccepted, type LoadAccess } from './context';
import type { DocumentRow } from './documents.service';

/** Declared value above which an e-way bill is required (Rs). */
export const EWAY_THRESHOLD_INR = 50_000;
const EXPIRING_DAYS = 15;

export type ChecklistStatus = 'ok' | 'expiring' | 'missing' | 'expired' | 'inconsistent' | 'not_required';
export const ISSUE_STATUSES: readonly ChecklistStatus[] = ['missing', 'expired', 'inconsistent'];

export interface ChecklistItem {
  key: string;
  label: string;
  required: boolean;
  status: ChecklistStatus;
  message: string;
  document_id: string | null;
}

export interface EwayRequirement { required: boolean; reason: string | null }

/** Whether the goods need an e-way bill, and why. Hazardous goods need one at any value. */
export function ewayRequirement(input: { flagged?: boolean | null; hazmat?: boolean; declaredValue?: number | null; threshold?: number }): EwayRequirement {
  const threshold = input.threshold ?? EWAY_THRESHOLD_INR;
  if (input.hazmat) return { required: true, reason: 'Hazardous goods need an e-way bill at any value' };
  if (input.flagged) return { required: true, reason: 'The load was marked as needing an e-way bill' };
  if (input.declaredValue != null && input.declaredValue > threshold) {
    return { required: true, reason: `Declared value is over Rs ${threshold.toLocaleString('en-IN')}` };
  }
  return { required: false, reason: null };
}

type ChecklistDoc = Pick<DocumentRow, 'id' | 'kind' | 'status' | 'number' | 'valid_until' | 'fields'>;

export interface ChecklistInput {
  now?: Date;
  accepted: boolean;
  eway: EwayRequirement;
  docs: ChecklistDoc[];
  vehicle: Record<string, any> | null;
  driver: { name: string | null; licence: LicenceInfo | null; licenceGraceDays?: number } | null;
}

const live = (d: ChecklistDoc) => d.status !== 'cancelled' && d.status !== 'superseded';

export function evaluateChecklist(input: ChecklistInput): ChecklistItem[] {
  const now = input.now ?? new Date();
  const today = indianDateKey(now);
  const items: ChecklistItem[] = [];
  const add = (key: string, label: string, required: boolean, status: ChecklistStatus, message: string, documentId: string | null = null) =>
    items.push({ key, label, required, status, message, document_id: documentId });
  const docs = input.docs.filter(live);

  // Invoice or challan
  const invoice = docs.find(d => INVOICE_KINDS.includes(d.kind));
  if (invoice) add('invoice', 'Invoice or challan', true, 'ok', `${DOC_LABELS[invoice.kind]}${invoice.number ? ` ${invoice.number}` : ''} is on file`, invoice.id);
  else add('invoice', 'Invoice or challan', true, 'missing', 'Add the supplier invoice, bill of supply or delivery challan');

  // E-way bill
  const eway = docs.find(d => d.kind === 'eway_bill');
  const ewayExpired = !!eway && (eway.status === 'expired' || (!!eway.valid_until && Date.parse(eway.valid_until) < now.getTime()));
  if (!eway) {
    add('eway_bill', 'E-way bill', input.eway.required, input.eway.required ? 'missing' : 'not_required',
      input.eway.required ? `E-way bill needed: ${input.eway.reason}` : 'Not needed for these goods');
  } else if (ewayExpired) {
    add('eway_bill', 'E-way bill', input.eway.required, 'expired', `E-way bill ${eway.number ?? ''} expired${eway.valid_until ? ` on ${indianDateKey(new Date(eway.valid_until))}` : ''}. Extend or issue a new one`.replace('  ', ' '), eway.id);
  } else {
    add('eway_bill', 'E-way bill', input.eway.required, 'ok', `E-way bill ${eway.number ?? ''} is valid${eway.valid_until ? ` until ${indianDateKey(new Date(eway.valid_until))}` : ''}`.replace('  ', ' '), eway.id);
  }

  // The vehicle the e-way bill names against the one assigned
  const plate = typeof input.vehicle?.plate_number === 'string' ? input.vehicle.plate_number : null;
  if (eway && plate) {
    const named = normalisePlate(eway.fields?.vehicle_number);
    if (!named) add('eway_bill_vehicle', 'E-way bill vehicle', input.eway.required, 'missing', `The e-way bill has no vehicle number; the assigned vehicle is ${plate}`, eway.id);
    else if (named !== normalisePlate(plate)) add('eway_bill_vehicle', 'E-way bill vehicle', true, 'inconsistent', `The e-way bill names vehicle ${eway.fields.vehicle_number} but ${plate} is assigned. Update Part B`, eway.id);
    else add('eway_bill_vehicle', 'E-way bill vehicle', input.eway.required, 'ok', `The e-way bill names the assigned vehicle ${plate}`, eway.id);
  }

  // LR once a company has accepted
  const lr = docs.find(d => d.kind === 'lr');
  if (!input.accepted) add('lr', 'LR / GR consignment note', false, 'not_required', 'Generated once a logistic company accepts the load');
  else if (lr) add('lr', 'LR / GR consignment note', true, 'ok', `LR ${lr.number ?? ''} is generated`.replace('  ', ' '), lr.id);
  else add('lr', 'LR / GR consignment note', true, 'missing', 'Generate the LR / GR consignment note');

  // Vehicle and its documents
  if (!input.accepted) {
    add('vehicle', 'Vehicle', false, 'not_required', 'Assigned after a logistic company accepts the load');
  } else if (!input.vehicle) {
    add('vehicle', 'Vehicle', true, 'missing', 'No vehicle is assigned yet');
  } else {
    add('vehicle', 'Vehicle', true, 'ok', `Vehicle ${plate ?? ''} is assigned`.replace('  ', ' '));
    const vehicleDoc = (key: string, label: string, expiry: unknown, required: boolean) => {
      if (typeof expiry !== 'string' || !expiry) {
        if (required) add(key, label, true, 'missing', `${label} is not on record for ${plate ?? 'the vehicle'}`);
        else add(key, label, false, 'not_required', `${label} is not on record`);
        return;
      }
      const date = expiry.slice(0, 10);
      const days = daysBetween(today, date);
      if (days < 0) add(key, label, true, 'expired', `${label} expired on ${date}`);
      else if (days <= EXPIRING_DAYS) add(key, label, true, 'expiring', `${label} expires on ${date} (${days} day${days === 1 ? '' : 's'})`);
      else add(key, label, true, 'ok', `${label} valid until ${date}`);
    };
    vehicleDoc('vehicle_rc', 'Registration certificate', input.vehicle.rc_expiry, true);
    vehicleDoc('vehicle_insurance', 'Insurance', input.vehicle.insurance_expiry, true);
    vehicleDoc('vehicle_fitness', 'Fitness certificate', input.vehicle.fitness_expiry, true);
    vehicleDoc('vehicle_puc', 'Pollution certificate (PUC)', input.vehicle.puc_expiry, true);
    vehicleDoc('vehicle_permit', 'Permit', input.vehicle.permit_expiry, false);
  }

  // Driver licence
  if (!input.accepted || !input.vehicle) {
    add('driver_licence', 'Driver licence', false, 'not_required', 'Checked once a vehicle and driver are assigned');
  } else if (!input.driver) {
    add('driver_licence', 'Driver licence', true, 'missing', 'No driver is assigned to the vehicle');
  } else {
    const lic = input.driver.licence;
    const who = input.driver.name ?? 'The driver';
    if (!lic || lic.status === 'missing') add('driver_licence', 'Driver licence', true, 'missing', `${who}'s driving licence is not on record`);
    else if (lic.status === 'expired' && !lic.in_grace) add('driver_licence', 'Driver licence', true, 'expired', `${who}'s driving licence has expired`);
    else if (lic.status === 'expired') add('driver_licence', 'Driver licence', true, 'expiring', `${who}'s driving licence expired but is within the grace period`);
    else if (licenceClassProblem(lic.classes, input.vehicle)) add('driver_licence', 'Driver licence', true, 'inconsistent', `${who}'s licence class does not cover this vehicle`);
    else if (lic.status === 'expiring') add('driver_licence', 'Driver licence', true, 'expiring', `${who}'s driving licence expires soon`);
    else add('driver_licence', 'Driver licence', true, 'ok', `${who}'s driving licence is valid`);
  }
  return items;
}

export interface DispatchCheck {
  load_id: string;
  eway: EwayRequirement & { declared_value: number | null; threshold: number };
  items: ChecklistItem[];
  issues: number;
  ready: boolean;
  /** `warn` shows the flags; `block` (the company setting dispatch_block_on_missing_docs) also stops dispatch. */
  mode: 'warn' | 'block';
  can_dispatch: boolean;
}

const truthy = (raw: unknown): boolean => {
  const v = raw && typeof raw === 'object' && 'value' in (raw as object) ? (raw as { value?: unknown }).value : raw;
  return v === true || v === 'true' || v === 1 || v === '1';
};

/** The company setting `dispatch_block_on_missing_docs` (off unless it is set). */
export async function blocksOnMissingDocs(carrierOrgId: string | null): Promise<boolean> {
  return truthy(await readEffectiveSetting('dispatch_block_on_missing_docs', carrierOrgId ?? undefined));
}

const money = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** What the load says about its goods: declared value and whether they are hazardous. */
function goodsOf(access: LoadAccess, docs: ChecklistDoc[]): { declared: number | null; hazmat: boolean } {
  const { load, manifests } = access;
  const cargo = (load.metadata && typeof load.metadata === 'object' && load.metadata.cargo) || {};
  const manifestSum = manifests.filter(m => !m.parent_manifest_id).reduce((s, m) => s + (money(m.declared_value) ?? 0), 0);
  const invoiceMax = docs.filter(d => INVOICE_KINDS.includes(d.kind) && live(d)).reduce((m, d) => Math.max(m, money(d.fields?.total_value) ?? 0), 0);
  const declared = money(load.total_declared_value) ?? money(cargo.declaredValue) ?? money(cargo.declared_value) ?? money(cargo.value)
    ?? (manifestSum > 0 ? manifestSum : null) ?? (invoiceMax > 0 ? invoiceMax : null);
  const handling: unknown[] = Array.isArray(load.special_handling) ? load.special_handling : [];
  const hazmat = load.hazmat_mixed === true || handling.includes('hazmat') || cargo.hazardous === true || /hazard|dangerous/i.test(String(cargo.category ?? ''));
  return { declared, hazmat };
}

/** The checklist for a load: its documents, the assigned vehicle and driver, and the company's blocking setting. */
export async function dispatchCheck(access: LoadAccess, docs: DocumentRow[]): Promise<DispatchCheck> {
  const facts = await loadFacts(access);
  const goods = goodsOf(access, docs);
  const eway = ewayRequirement({ flagged: access.load.eway_required === true, hazmat: goods.hazmat, declaredValue: goods.declared });

  let driver: ChecklistInput['driver'] = null;
  if (facts.driver) {
    let docsOfDriver: DocRow[] = [];
    if (facts.driver.id) {
      const { data, error } = await supabase.from('user_documents').select('id, user_id, doc_type, status, expires_on, metadata, archived_at')
        .eq('user_id', facts.driver.id).eq('doc_type', 'driving_licence').is('archived_at', null);
      if (error) throw new Error(`Failed to read the driver's documents: ${error.message}`);
      docsOfDriver = (data ?? []) as DocRow[];
    }
    const grace = (await getPeopleSettings({ cached: true, orgId: access.carrierOrgId ?? undefined })).licence_grace_days;
    driver = { name: facts.driver.name, licence: facts.driver.id ? licenceInfo(docsOfDriver, indianDateKey(new Date()), grace) : null };
  }

  const accepted = transporterAccepted(access);
  const items = evaluateChecklist({ accepted, eway, docs, vehicle: facts.vehicle, driver });
  const issues = items.filter(i => ISSUE_STATUSES.includes(i.status)).length;
  const block = await blocksOnMissingDocs(access.carrierOrgId);
  return {
    load_id: access.load.id,
    eway: { ...eway, declared_value: goods.declared, threshold: EWAY_THRESHOLD_INR },
    items, issues, ready: issues === 0,
    mode: block ? 'block' : 'warn',
    can_dispatch: !(block && issues > 0),
  };
}
