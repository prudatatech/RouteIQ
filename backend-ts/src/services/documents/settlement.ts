/**
 * margixindia — Trip settlement of a load: agreed freight, advance, approved extra charges, deductions, balance.
 *
 * Amounts are integer paise in the database and in every calculation; the API speaks rupees (a number with up to
 * two decimals) and converts at the edge. Balance = freight + approved extras - deductions - advance; an extra
 * charge counts only once it is approved. The balance is always recomputed here, never taken from the client.
 */
import { z } from 'zod';
import { supabase } from '../../core/supabase';
import { HttpError } from '../../core/errors';
import { auditService } from '../audit.service';
import { parseBody, PAYMENT_TERMS } from './schemas';
import { requireCarrier, type LoadAccess } from './context';

export interface ExtraCharge { label: string; amount: number; added_by?: string | null; added_at?: string | null; approved_by?: string | null; approved_at?: string | null }
export interface Deduction { label: string; amount: number; reason?: string | null; added_by?: string | null; added_at?: string | null }

export interface SettlementRow {
  id: string;
  load_id: string;
  shipment_id: string | null;
  carrier_org_id: string;
  vendor_org_id: string | null;
  agreed_freight: number;
  advance_paid: number;
  extra_charges: ExtraCharge[];
  deductions: Deduction[];
  balance: number;
  payment_terms: (typeof PAYMENT_TERMS)[number];
  payment_status: 'pending' | 'partial' | 'paid';
  pod_document_id: string | null;
  status: 'open' | 'closed';
  closed_at: string | null;
  closed_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Rupees to integer paise. A sum of paise stays exact; a rupee amount with a float error (0.1 + 0.2) rounds to the paisa. */
export const toPaise = (rupees: number): number => Math.round(Number((rupees * 100).toPrecision(15)));
export const toRupees = (paise: number): number => paise / 100;

const isApproved = (e: ExtraCharge) => !!e.approved_at;

/** freight + approved extras - deductions - advance, in paise. */
export function computeBalance(s: Pick<SettlementRow, 'agreed_freight' | 'advance_paid' | 'extra_charges' | 'deductions'>): number {
  const extras = (s.extra_charges ?? []).filter(isApproved).reduce((sum, e) => sum + e.amount, 0);
  const deductions = (s.deductions ?? []).reduce((sum, d) => sum + d.amount, 0);
  return s.agreed_freight + extras - deductions - s.advance_paid;
}

export interface SettlementView {
  id: string;
  load_id: string;
  shipment_id: string | null;
  carrier_org_id: string;
  status: 'open' | 'closed';
  payment_terms: SettlementRow['payment_terms'];
  payment_status: SettlementRow['payment_status'];
  /** Rupees. */
  agreed_freight: number;
  advance_paid: number;
  extra_charges: Array<{ idx: number; label: string; amount: number; added_at: string | null; approved: boolean; approved_by: string | null; approved_at: string | null }>;
  deductions: Array<{ idx: number; label: string; amount: number; reason: string | null; added_at: string | null }>;
  approved_extras_total: number;
  pending_extras_total: number;
  deductions_total: number;
  balance: number;
  pod_document_id: string | null;
  closed_at: string | null;
  closed_by: string | null;
  created_at: string;
  updated_at: string;
}

export function settlementView(row: SettlementRow): SettlementView {
  const extras = row.extra_charges ?? [];
  const deductions = row.deductions ?? [];
  const sum = (list: Array<{ amount: number }>) => list.reduce((s, x) => s + x.amount, 0);
  return {
    id: row.id, load_id: row.load_id, shipment_id: row.shipment_id, carrier_org_id: row.carrier_org_id,
    status: row.status, payment_terms: row.payment_terms, payment_status: row.payment_status,
    agreed_freight: toRupees(row.agreed_freight),
    advance_paid: toRupees(row.advance_paid),
    extra_charges: extras.map((e, idx) => ({
      idx, label: e.label, amount: toRupees(e.amount), added_at: e.added_at ?? null,
      approved: isApproved(e), approved_by: e.approved_by ?? null, approved_at: e.approved_at ?? null,
    })),
    deductions: deductions.map((d, idx) => ({ idx, label: d.label, amount: toRupees(d.amount), reason: d.reason ?? null, added_at: d.added_at ?? null })),
    approved_extras_total: toRupees(sum(extras.filter(isApproved))),
    pending_extras_total: toRupees(sum(extras.filter(e => !isApproved(e)))),
    deductions_total: toRupees(sum(deductions)),
    balance: toRupees(computeBalance(row)),
    pod_document_id: row.pod_document_id, closed_at: row.closed_at, closed_by: row.closed_by,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export async function findSettlement(loadId: string): Promise<SettlementRow | null> {
  const { data, error } = await supabase.from('trip_settlements').select('*').eq('load_id', loadId).maybeSingle();
  if (error) throw new Error(`Failed to read the settlement: ${error.message}`);
  return (data as SettlementRow | null) ?? null;
}

/** The settlement of the load (any side may read it), or a 404 when none has been opened. */
export async function getSettlement(access: LoadAccess): Promise<SettlementView> {
  const row = await findSettlement(access.load.id);
  if (!row) throw new HttpError(404, 'No settlement has been opened for this load');
  return settlementView(row);
}

const rupees = z.number().finite().min(0).max(100_000_000);
const settlementBody = z.object({
  agreed_freight: rupees.optional(),
  advance_paid: rupees.optional(),
  payment_terms: z.enum(PAYMENT_TERMS).optional(),
  shipment_id: z.string().uuid().optional(),
});
const extraBody = z.object({ label: z.string().trim().min(1).max(120), amount: rupees.refine(v => v > 0, 'amount must be more than 0') });
const deductionBody = z.object({
  label: z.string().trim().min(1).max(120),
  amount: rupees.refine(v => v > 0, 'amount must be more than 0'),
  reason: z.string().trim().min(3, 'A reason of at least 3 characters is required').max(300),
});

async function audit(access: LoadAccess, action: string, subject: Record<string, unknown>) {
  await auditService.record('staff-console', { user_id: access.userId, role: access.viewer }, action, { load_id: access.load.id, ...subject });
}

async function openSettlement(access: LoadAccess): Promise<SettlementRow> {
  requireCarrier(access);
  const row = await findSettlement(access.load.id);
  if (!row) throw new HttpError(409, 'Open the settlement first');
  if (row.status === 'closed') throw new HttpError(409, 'This trip is closed');
  return row;
}

/** Saves the computed balance with the change, only if nobody else changed the row since it was read. */
async function save(access: LoadAccess, current: SettlementRow, patch: Partial<SettlementRow>): Promise<SettlementRow> {
  const next = { ...current, ...patch };
  const { data, error } = await supabase.from('trip_settlements')
    .update({ ...patch, balance: computeBalance(next), updated_at: new Date().toISOString() })
    .eq('id', current.id).eq('updated_at', current.updated_at).eq('status', 'open')
    .select('*').maybeSingle();
  if (error) throw new Error(`Failed to save the settlement: ${error.message}`);
  if (!data) throw new HttpError(409, 'The settlement was changed by someone else. Reload and try again.');
  return data as SettlementRow;
}

/** Opens the settlement (the agreed freight defaults to the load's price) or updates freight, advance and terms. */
export async function upsertSettlement(access: LoadAccess, raw: unknown): Promise<SettlementView> {
  requireCarrier(access);
  const input = parseBody(settlementBody, raw);
  const current = await findSettlement(access.load.id);
  if (current) {
    if (current.status === 'closed') throw new HttpError(409, 'This trip is closed');
    const patch: Partial<SettlementRow> = {};
    if (input.agreed_freight !== undefined) patch.agreed_freight = toPaise(input.agreed_freight);
    if (input.advance_paid !== undefined) patch.advance_paid = toPaise(input.advance_paid);
    if (input.payment_terms) patch.payment_terms = input.payment_terms;
    if (input.shipment_id) patch.shipment_id = input.shipment_id;
    const row = Object.keys(patch).length ? await save(access, current, patch) : current;
    await audit(access, 'trip_settlement_updated', { settlement_id: row.id, changed: Object.keys(patch) });
    return settlementView(row);
  }
  if (!access.carrierOrgId) throw new HttpError(409, 'This load has no logistic company yet');
  const priced = Number(access.load.cost);
  const agreed = input.agreed_freight !== undefined ? toPaise(input.agreed_freight) : Number.isFinite(priced) && priced > 0 ? toPaise(priced) : 0;
  const advance = toPaise(input.advance_paid ?? 0);
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('trip_settlements').insert({
    load_id: access.load.id,
    shipment_id: input.shipment_id ?? null,
    carrier_org_id: access.carrierOrgId,
    vendor_org_id: access.vendorOrgId,
    agreed_freight: agreed,
    advance_paid: advance,
    extra_charges: [],
    deductions: [],
    balance: computeBalance({ agreed_freight: agreed, advance_paid: advance, extra_charges: [], deductions: [] }),
    payment_terms: input.payment_terms ?? 'to_be_billed',
    payment_status: 'pending',
    status: 'open',
    created_by: access.userId,
    created_at: now,
    updated_at: now,
  }).select('*').single();
  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'A settlement is already open for this load');
    throw new Error(`Failed to open the settlement: ${error.message}`);
  }
  await audit(access, 'trip_settlement_opened', { settlement_id: (data as SettlementRow).id });
  return settlementView(data as SettlementRow);
}

export async function addExtraCharge(access: LoadAccess, raw: unknown): Promise<SettlementView> {
  const input = parseBody(extraBody, raw);
  const current = await openSettlement(access);
  const charge: ExtraCharge = { label: input.label, amount: toPaise(input.amount), added_by: access.userId, added_at: new Date().toISOString(), approved_by: null, approved_at: null };
  const row = await save(access, current, { extra_charges: [...current.extra_charges, charge] });
  await audit(access, 'trip_extra_charge_added', { settlement_id: row.id, label: input.label, amount: input.amount });
  return settlementView(row);
}

export async function approveExtraCharge(access: LoadAccess, rawIdx: unknown): Promise<SettlementView> {
  const idx = Number(rawIdx);
  const current = await openSettlement(access);
  if (!Number.isInteger(idx) || idx < 0 || idx >= current.extra_charges.length) throw new HttpError(404, 'Extra charge not found');
  if (current.extra_charges[idx].approved_at) return settlementView(current);
  const extras = current.extra_charges.map((e, i) => (i === idx ? { ...e, approved_by: access.userId, approved_at: new Date().toISOString() } : e));
  const row = await save(access, current, { extra_charges: extras });
  await audit(access, 'trip_extra_charge_approved', { settlement_id: row.id, label: extras[idx].label, amount: toRupees(extras[idx].amount) });
  return settlementView(row);
}

export async function addDeduction(access: LoadAccess, raw: unknown): Promise<SettlementView> {
  const input = parseBody(deductionBody, raw);
  const current = await openSettlement(access);
  // What can be deducted is what the carrier is owed for the trip (freight and approved extras): more than that is a mistake
  const owed = current.agreed_freight + current.extra_charges.filter(isApproved).reduce((sum, e) => sum + e.amount, 0);
  const deducted = current.deductions.reduce((sum, d) => sum + d.amount, 0) + toPaise(input.amount);
  if (deducted > owed) throw new HttpError(400, `The deductions (₹${toRupees(deducted)}) are more than the freight and approved extras (₹${toRupees(owed)})`);
  const deduction: Deduction = { label: input.label, amount: toPaise(input.amount), reason: input.reason, added_by: access.userId, added_at: new Date().toISOString() };
  const row = await save(access, current, { deductions: [...current.deductions, deduction] });
  await audit(access, 'trip_deduction_added', { settlement_id: row.id, label: input.label, amount: input.amount });
  return settlementView(row);
}

export { openSettlement, save as saveSettlement, audit as auditSettlement };
