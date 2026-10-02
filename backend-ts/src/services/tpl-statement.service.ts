/**
 * margixindia — Partner settlement v1 (docs/network-design.md, section 2).
 *
 * A statement is the month's account between one company and one of its 3PL partners: the orders the partner
 * delivered for the company in that month (agreed amounts, in paise), the deductions the company takes
 * (label, amount, reason) and the balance it pays. draft -> issued -> paid. The company writes it, the partner reads
 * it once issued. All money is integer paise and the balance is always recomputed here, never taken from a client.
 *
 * Orders reach a statement through their offer: the company that made the offer (offer.carrier_org_id) is the one that
 * owes the money. An order inside an issued or paid statement can no longer be marked paid on its own (see
 * statementCoveringOrder, used by tpl-network markPaid).
 */
import { z } from 'zod';
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { indianDayStart } from '../core/istDate';
import { auditService, type AuditActor } from './audit.service';
import { notifyOrg } from './org.service';
import { assertAffiliated, legacyPartnerIdOf } from './tpl-affiliation';

export const PERIOD_PATTERN = /^[0-9]{4}(0[1-9]|1[0-2])$/;
const MAX_DEDUCTIONS = 50;
const MAX_PAISE = 1_000_000_000_000; // ₹10,000 crore: nothing real is above it, and it keeps every sum an exact integer

export const StatementBuildSchema = z.object({
  period: z.string({ invalid_type_error: 'Choose the month (YYYYMM)', required_error: 'Choose the month (YYYYMM)' }).regex(PERIOD_PATTERN, 'The month must look like 202610'),
}).strict();

export const DeductionSchema = z.object({
  label: z.string({ invalid_type_error: 'Give the deduction a label', required_error: 'Give the deduction a label' }).trim().min(1, 'Give the deduction a label').max(100, 'The label can be at most 100 characters'),
  amount_paise: z.number({ invalid_type_error: 'The amount must be a number', required_error: 'The amount must be a number' }).int('The amount must be whole paise').positive('The amount must be more than 0').max(MAX_PAISE, 'The amount is too large'),
  reason: z.string().trim().max(300, 'The reason can be at most 300 characters').default(''),
}).strict();
export type Deduction = z.infer<typeof DeductionSchema>;

export const StatementUpdateSchema = z.object({
  deductions: z.array(DeductionSchema).max(MAX_DEDUCTIONS, `At most ${MAX_DEDUCTIONS} deductions`).optional(),
  /** Pull the month's delivered orders again (a draft only); the deductions stay. */
  rebuild: z.boolean().optional(),
}).strict().refine(v => v.deductions !== undefined || v.rebuild, { message: 'Send the deductions, or rebuild: true' });

export const StatementPaidSchema = z.object({
  reference: z.string().trim().max(100, 'The reference can be at most 100 characters').optional(),
}).strict();

/** Rupees as stored (numeric(12,2)) to integer paise. */
export const toPaise = (rupees: unknown): number => Math.round(Number(rupees) * 100);

/** The orders total less the deductions, in paise. A deduction can never take the balance below zero. */
export function settle(ordersTotalPaise: number, deductions: Array<{ amount_paise: number }>): { deductions_total_paise: number; balance_paise: number } {
  const total = deductions.reduce((sum, d) => sum + d.amount_paise, 0);
  const balance = ordersTotalPaise - total;
  if (balance < 0) throw new HttpError(422, 'The deductions are more than the orders come to', { field: 'deductions' });
  return { deductions_total_paise: total, balance_paise: balance };
}

/** The [start, end) instants of an Indian calendar month given as YYYYMM. */
export function periodRange(period: string): { start: Date; end: Date } {
  if (!PERIOD_PATTERN.test(period)) throw new HttpError(422, 'The month must look like 202610', { field: 'period' });
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(4));
  const pad = (n: number) => String(n).padStart(2, '0');
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`;
  return { start: indianDayStart(`${year}-${pad(month)}-01`), end: indianDayStart(next) };
}

interface StatementRow {
  id: string;
  partner_org_id: string;
  company_org_id: string;
  period: string;
  order_ids: string[];
  orders_total_paise: number | string;
  deductions: Deduction[];
  balance_paise: number | string;
  status: 'draft' | 'issued' | 'paid';
  issued_at: string | null;
  paid_at: string | null;
  paid_reference: string | null;
  created_at: string;
  updated_at: string;
}

export interface StatementOrderLine {
  id: string;
  pickup_location: string | null;
  drop_location: string | null;
  delivered_at: string | null;
  amount_paise: number;
}

export interface OrgParty { id: string; name: string; legal_name: string | null; gstin: string | null; address: string | null; city: string | null; state: string | null; pincode: string | null }

export interface StatementView {
  id: string;
  partner_org_id: string;
  company_org_id: string;
  partner_name: string | null;
  company_name: string | null;
  period: string;
  status: 'draft' | 'issued' | 'paid';
  order_ids: string[];
  order_count: number;
  orders_total_paise: number;
  deductions: Deduction[];
  deductions_total_paise: number;
  balance_paise: number;
  issued_at: string | null;
  paid_at: string | null;
  paid_reference: string | null;
  created_at: string;
  /** Only on a single statement (not in lists). */
  orders?: StatementOrderLine[];
}

const COLUMNS = 'id, partner_org_id, company_org_id, period, order_ids, orders_total_paise, deductions, balance_paise, status, issued_at, paid_at, paid_reference, created_at, updated_at';

function failed(action: string, error: { message: string } | null): never {
  throw new Error(`${action}: ${error?.message}`);
}

const deductionsOf = (row: StatementRow): Deduction[] => (Array.isArray(row.deductions) ? row.deductions : []);

async function parties(ids: string[]): Promise<Map<string, OrgParty>> {
  const { data, error } = await supabase.from('organizations')
    .select('id, name, legal_name, gstin, address, city, state, pincode').in('id', [...new Set(ids)]);
  if (error) failed('Failed to load organisations', error);
  return new Map((data ?? []).map(o => [o.id as string, o as OrgParty]));
}

function toView(row: StatementRow, names: Map<string, OrgParty>): StatementView {
  const deductions = deductionsOf(row);
  const ids = Array.isArray(row.order_ids) ? row.order_ids : [];
  return {
    id: row.id,
    partner_org_id: row.partner_org_id,
    company_org_id: row.company_org_id,
    partner_name: names.get(row.partner_org_id)?.name ?? null,
    company_name: names.get(row.company_org_id)?.name ?? null,
    period: row.period,
    status: row.status,
    order_ids: ids,
    order_count: ids.length,
    orders_total_paise: Number(row.orders_total_paise),
    deductions,
    deductions_total_paise: deductions.reduce((s, d) => s + d.amount_paise, 0),
    balance_paise: Number(row.balance_paise),
    issued_at: row.issued_at,
    paid_at: row.paid_at,
    paid_reference: row.paid_reference,
    created_at: row.created_at,
  };
}

async function orderLines(ids: string[]): Promise<StatementOrderLine[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from('tpl_orders')
    .select('id, pickup_location, drop_location, delivered_at, agreed_amount').in('id', ids).order('delivered_at', { ascending: true });
  if (error) failed('Failed to load orders', error);
  return (data ?? []).map(o => ({
    id: o.id, pickup_location: o.pickup_location ?? null, drop_location: o.drop_location ?? null,
    delivered_at: o.delivered_at ?? null, amount_paise: toPaise(o.agreed_amount),
  }));
}

async function withDetail(row: StatementRow): Promise<StatementView> {
  const names = await parties([row.partner_org_id, row.company_org_id]);
  return { ...toView(row, names), orders: await orderLines(Array.isArray(row.order_ids) ? row.order_ids : []) };
}

async function load(companyOrgId: string, tplOrgId: string, id: string): Promise<StatementRow> {
  const { data, error } = await supabase.from('tpl_partner_statements').select(COLUMNS)
    .eq('id', id).eq('company_org_id', companyOrgId).eq('partner_org_id', tplOrgId).maybeSingle();
  if (error) failed('Failed to load the statement', error);
  if (!data) throw new HttpError(404, 'Statement not found');
  return data as StatementRow;
}

/** The delivered, unpaid orders a partner did for a company in an Indian calendar month, with their paise. */
async function ordersFor(companyOrgId: string, partnerId: string, period: string): Promise<Array<{ id: string; paise: number }>> {
  const { start, end } = periodRange(period);
  const { data: orders, error } = await supabase.from('tpl_orders')
    .select('id, offer_id, agreed_amount, delivered_at, paid_at')
    .eq('partner_id', partnerId).eq('status', 'delivered')
    .gte('delivered_at', start.toISOString()).lt('delivered_at', end.toISOString());
  if (error) failed('Failed to load orders', error);
  const open = (orders ?? []).filter(o => !o.paid_at);
  if (open.length === 0) return [];
  const { data: offers, error: oErr } = await supabase.from('tpl_offers')
    .select('id, carrier_org_id').in('id', open.map(o => o.offer_id));
  if (oErr) failed('Failed to load offers', oErr);
  const company = new Map((offers ?? []).map(o => [o.id as string, o.carrier_org_id as string | null]));
  return open.filter(o => company.get(o.offer_id) === companyOrgId).map(o => ({ id: o.id as string, paise: toPaise(o.agreed_amount) }));
}

const audit = (actor: AuditActor, action: string, subject: Record<string, unknown>) =>
  auditService.record('staff-console', actor, action, subject);

export const tplStatementService = {
  /** Statements of one partner, newest month first (the company's working list: drafts too). */
  async list(companyOrgId: string, tplOrgId: string): Promise<StatementView[]> {
    await assertAffiliated(companyOrgId, tplOrgId);
    const { data, error } = await supabase.from('tpl_partner_statements').select(COLUMNS)
      .eq('company_org_id', companyOrgId).eq('partner_org_id', tplOrgId).order('period', { ascending: false });
    if (error) failed('Failed to load statements', error);
    const names = await parties([companyOrgId, tplOrgId]);
    return ((data ?? []) as StatementRow[]).map(r => toView(r, names));
  },

  async get(companyOrgId: string, tplOrgId: string, id: string): Promise<StatementView> {
    return withDetail(await load(companyOrgId, tplOrgId, id));
  },

  /**
   * Builds the statement of a month from the partner's delivered orders. Asking again for a month that is still a
   * draft refreshes its orders and keeps its deductions; an issued or paid month is final (409).
   */
  async build(actor: AuditActor, companyOrgId: string, tplOrgId: string, period: string): Promise<{ statement: StatementView; created: boolean }> {
    periodRange(period);
    await assertAffiliated(companyOrgId, tplOrgId);
    const partnerId = await legacyPartnerIdOf(tplOrgId);
    const orders = partnerId ? await ordersFor(companyOrgId, partnerId, period) : [];
    const { data: existing, error } = await supabase.from('tpl_partner_statements').select(COLUMNS)
      .eq('company_org_id', companyOrgId).eq('partner_org_id', tplOrgId).eq('period', period).maybeSingle();
    if (error) failed('Failed to check the statement', error);
    if (existing && (existing as StatementRow).status !== 'draft') {
      throw new HttpError(409, `The ${period} statement is already ${(existing as StatementRow).status}`);
    }
    if (orders.length === 0 && !existing) throw new HttpError(409, 'This partner has no delivered orders for you in that month');

    const ordersTotal = orders.reduce((s, o) => s + o.paise, 0);
    const fields = { order_ids: orders.map(o => o.id), orders_total_paise: ordersTotal };
    if (existing) {
      const row = existing as StatementRow;
      const { balance_paise } = settle(ordersTotal, deductionsOf(row));
      const { data, error: uErr } = await supabase.from('tpl_partner_statements')
        .update({ ...fields, balance_paise, updated_at: new Date().toISOString() }).eq('id', row.id).eq('status', 'draft').select(COLUMNS).maybeSingle();
      if (uErr) failed('Failed to refresh the statement', uErr);
      if (!data) throw new HttpError(409, 'This statement just changed. Refresh and try again');
      return { statement: await withDetail(data as StatementRow), created: false };
    }
    const { data, error: iErr } = await supabase.from('tpl_partner_statements')
      .insert({ partner_org_id: tplOrgId, company_org_id: companyOrgId, period, ...fields, deductions: [], balance_paise: ordersTotal, status: 'draft', created_by: actor.user_id })
      .select(COLUMNS).single();
    if (iErr) {
      if ((iErr as { code?: string }).code === '23505') throw new HttpError(409, `A statement for ${period} already exists`);
      failed('Failed to create the statement', iErr);
    }
    await audit(actor, 'tpl_statement.built', { statement_id: data.id, company_id: companyOrgId, tpl_id: tplOrgId, period });
    return { statement: await withDetail(data as StatementRow), created: true };
  },

  /** Replaces the deductions of a draft (the balance is recomputed), or pulls the month's orders again. */
  async update(actor: AuditActor, companyOrgId: string, tplOrgId: string, id: string, input: z.infer<typeof StatementUpdateSchema>): Promise<StatementView> {
    const row = await load(companyOrgId, tplOrgId, id);
    if (row.status !== 'draft') throw new HttpError(409, `This statement is already ${row.status} and cannot be changed`);
    if (input.rebuild) {
      if (input.deductions !== undefined) {
        const { balance_paise } = settle(Number(row.orders_total_paise), input.deductions);
        await supabase.from('tpl_partner_statements').update({ deductions: input.deductions, balance_paise }).eq('id', id).eq('status', 'draft');
      }
      return (await this.build(actor, companyOrgId, tplOrgId, row.period)).statement;
    }
    const deductions = input.deductions ?? [];
    const { balance_paise } = settle(Number(row.orders_total_paise), deductions);
    const { data, error } = await supabase.from('tpl_partner_statements')
      .update({ deductions, balance_paise, updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'draft').select(COLUMNS).maybeSingle();
    if (error) failed('Failed to save the deductions', error);
    if (!data) throw new HttpError(409, 'This statement just changed. Refresh and try again');
    await audit(actor, 'tpl_statement.deductions', { statement_id: id, count: deductions.length });
    return withDetail(data as StatementRow);
  },

  /** draft -> issued. The total is recomputed from the orders as they stand now; the partner is told. */
  async issue(actor: AuditActor, companyOrgId: string, tplOrgId: string, id: string): Promise<StatementView> {
    const row = await load(companyOrgId, tplOrgId, id);
    if (row.status !== 'draft') throw new HttpError(409, `This statement is already ${row.status}`);
    const ids = Array.isArray(row.order_ids) ? row.order_ids : [];
    if (ids.length === 0) throw new HttpError(409, 'There are no orders in this statement. Rebuild it first');
    const { data: orders, error } = await supabase.from('tpl_orders').select('id, agreed_amount, status, paid_at').in('id', ids);
    if (error) failed('Failed to check the orders', error);
    const current = orders ?? [];
    if (current.length !== ids.length || current.some(o => o.status !== 'delivered' || o.paid_at)) {
      throw new HttpError(409, 'Some orders in this statement changed (paid or no longer delivered). Rebuild the statement first');
    }
    const ordersTotal = current.reduce((s, o) => s + toPaise(o.agreed_amount), 0);
    const { balance_paise } = settle(ordersTotal, deductionsOf(row));
    const now = new Date().toISOString();
    const { data, error: uErr } = await supabase.from('tpl_partner_statements')
      .update({ status: 'issued', orders_total_paise: ordersTotal, balance_paise, issued_at: now, issued_by: actor.user_id, updated_at: now })
      .eq('id', id).eq('status', 'draft').select(COLUMNS).maybeSingle();
    if (uErr) failed('Failed to issue the statement', uErr);
    if (!data) throw new HttpError(409, 'This statement just changed. Refresh and try again');
    await audit(actor, 'tpl_statement.issued', { statement_id: id, company_id: companyOrgId, tpl_id: tplOrgId, period: row.period });
    const view = await withDetail(data as StatementRow);
    await notifyOrg(tplOrgId, `Statement for ${row.period} from ${view.company_name ?? 'a company'}`, 'Open Statements to see the orders, deductions and the balance.', 'tpl_statement_issued', { statement_id: id, company_id: companyOrgId, period: row.period });
    return view;
  },

  /** issued -> paid; the orders in it are marked paid with the same reference. */
  async markPaid(actor: AuditActor, companyOrgId: string, tplOrgId: string, id: string, referenceInput?: string): Promise<StatementView> {
    const row = await load(companyOrgId, tplOrgId, id);
    if (row.status !== 'issued') throw new HttpError(409, row.status === 'paid' ? 'This statement is already paid' : 'Issue the statement before marking it paid');
    const reference = referenceInput?.trim() || null;
    const now = new Date().toISOString();
    const { data, error } = await supabase.from('tpl_partner_statements')
      .update({ status: 'paid', paid_at: now, paid_reference: reference, paid_by: actor.user_id, updated_at: now })
      .eq('id', id).eq('status', 'issued').select(COLUMNS).maybeSingle();
    if (error) failed('Failed to mark the statement paid', error);
    if (!data) throw new HttpError(409, 'This statement just changed. Refresh and try again');
    const ids = Array.isArray(row.order_ids) ? row.order_ids : [];
    if (ids.length > 0) {
      const { error: oErr } = await supabase.from('tpl_orders').update({ paid_at: now, paid_reference: reference, updated_at: now }).in('id', ids);
      if (oErr) console.error('[tpl-statement] Could not mark the orders paid:', oErr.message);
    }
    await audit(actor, 'tpl_statement.paid', { statement_id: id, company_id: companyOrgId, tpl_id: tplOrgId, period: row.period });
    const view = await withDetail(data as StatementRow);
    await notifyOrg(tplOrgId, `Statement for ${row.period} marked paid`, `${view.company_name ?? 'The company'} marked it paid${reference ? ` (${reference})` : ''}.`, 'tpl_statement_paid', { statement_id: id, company_id: companyOrgId, period: row.period });
    return view;
  },

  // ── Partner side (read only) ───────────────────────────────────

  /** What a company issued to a partner: issued and paid statements, newest month first. */
  async listForPartner(tplOrgId: string): Promise<StatementView[]> {
    const { data, error } = await supabase.from('tpl_partner_statements').select(COLUMNS)
      .eq('partner_org_id', tplOrgId).in('status', ['issued', 'paid']).order('period', { ascending: false });
    if (error) failed('Failed to load statements', error);
    const rows = (data ?? []) as StatementRow[];
    const names = await parties([tplOrgId, ...rows.map(r => r.company_org_id)]);
    return rows.map(r => toView(r, names));
  },

  async getForPartner(tplOrgId: string, id: string): Promise<StatementView> {
    const { data, error } = await supabase.from('tpl_partner_statements').select(COLUMNS)
      .eq('id', id).eq('partner_org_id', tplOrgId).in('status', ['issued', 'paid']).maybeSingle();
    if (error) failed('Failed to load the statement', error);
    if (!data) throw new HttpError(404, 'Statement not found');
    return withDetail(data as StatementRow);
  },

  /** The two organisations of a statement, for its PDF. */
  async partiesOf(view: StatementView): Promise<{ company: OrgParty | null; partner: OrgParty | null }> {
    const map = await parties([view.company_org_id, view.partner_org_id]);
    return { company: map.get(view.company_org_id) ?? null, partner: map.get(view.partner_org_id) ?? null };
  },
};

/**
 * The issued or paid statement that holds this order, or null. An order in one is settled by it and must not be
 * marked paid on its own.
 */
export async function statementCoveringOrder(orderId: string): Promise<{ id: string; period: string; status: string } | null> {
  const { data, error } = await supabase.from('tpl_partner_statements')
    .select('id, period, status, order_ids').in('status', ['issued', 'paid'])
    // order_ids is jsonb: contains needs the JSON text, a bare array would be sent as a Postgres array literal
    .contains('order_ids', JSON.stringify([orderId]));
  if (error) failed('Failed to check statements', error);
  const hit = (data ?? []).find(s => Array.isArray(s.order_ids) && (s.order_ids as string[]).includes(orderId));
  return hit ? { id: hit.id, period: hit.period, status: hit.status } : null;
}
