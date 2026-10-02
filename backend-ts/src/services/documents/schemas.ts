/**
 * margixindia — What each kind of document records (PRD Appendix A2), validated with zod.
 *
 * `fields` of a document is parsed with the schema of its kind: unknown keys are dropped, a wrong type or an
 * out-of-range value is a 400 naming the field. Most fields are optional (a document is recorded with what is
 * known; nothing is invented); the few that identify it are required: the number of an invoice, challan or
 * e-way bill, and the 12-digit e-way bill number with its validity.
 */
import { z } from 'zod';
import { HttpError } from '../../core/errors';
import { DOC_KINDS, DOC_STATUSES, normalisePlate, type DocKind } from './kinds';

const text = (max = 200) => z.string().trim().max(max);
const optText = (max = 200) => text(max).optional();
const money = z.number().finite().min(0).max(1_000_000_000);
const qty = z.number().finite().min(0).max(10_000_000);
const dateText = z.string().trim().refine(v => !Number.isNaN(Date.parse(v)), 'must be a valid date');
const gstin = z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/, 'GSTIN must be 15 characters');
const plate = z.string().trim().min(4).max(20).transform(normalisePlate);
const paths = z.array(z.string().trim().min(1).max(300)).max(10);
export const PAYMENT_TERMS = ['paid', 'to_pay', 'to_be_billed'] as const;

const issuer = z.object({ name: optText(), address: optText(300), gstin: optText(20), phone: optText(30) }).optional();
const common = { issuer, load_number: optText(40), remarks: optText(1000) };

const goodsLine = z.object({ description: text(300), hsn: optText(12), quantity: qty.optional(), unit: optText(20), value: money.optional() });

const invoiceFields = z.object({
  ...common,
  document_type: optText(40),
  seller_name: optText(), seller_gstin: gstin.optional(),
  buyer_name: optText(), buyer_gstin: gstin.optional(),
  dispatch_from: optText(300), ship_to: optText(300),
  goods_lines: z.array(goodsLine).max(50).optional(),
  total_value: money.optional(),
});

const ewayFields = z.object({
  ...common,
  ewb_number: z.string().trim().regex(/^\d{12}$/, 'E-way bill number must be 12 digits'),
  generated_on: dateText.optional(),
  linked_document_number: optText(60), linked_document_date: dateText.optional(),
  transporter_id: gstin.optional(), transporter_name: optText(),
  vehicle_number: plate.optional(),
  approx_distance_km: z.number().int().min(0).max(5000).optional(),
});

const lrFields = z.object({
  ...common,
  transporter_name: optText(), transporter_gstin: optText(20),
  consignor_name: optText(), consignor_gstin: optText(20), consignee_name: optText(),
  pickup_address: optText(300), delivery_address: optText(300),
  vehicle_number: plate.optional(), driver_name: optText(), driver_phone: optText(30),
  goods_description: optText(500), packages: z.number().int().min(0).max(1_000_000).optional(),
  actual_weight_kg: qty.optional(), route: optText(300),
  freight_amount: money.optional(), payment_terms: z.enum(PAYMENT_TERMS).optional(),
  invoice_number: optText(60), eway_bill_number: optText(20),
});

const freightSheetFields = z.object({
  ...common,
  lr_number: optText(40), vehicle_number: plate.optional(),
  from_location: optText(300), to_location: optText(300),
  consignor_name: optText(), consignee_name: optText(),
  actual_weight_kg: qty.optional(), rate: money.optional(), rate_basis: optText(40),
  total_freight: money.optional(), paid_advance: money.optional(), amount_to_pay: money.optional(),
  payment_terms: z.enum(PAYMENT_TERMS).optional(),
  delivery_acknowledgement: optText(500),
});

const podFields = z.object({
  ...common,
  delivered_at: dateText.optional(),
  receiver_name: optText(), receiver_contact: optText(40),
  signature_path: optText(300), photo_paths: paths.optional(),
  delivered_quantity: qty.optional(), shortage_quantity: qty.optional(), damaged_quantity: qty.optional(),
  damage_details: optText(1000),
  /** True once the goods are fully delivered (a final POD); a partial delivery is a draft POD. */
  complete: z.boolean().optional(),
});

const custodyLine = z.object({
  at: dateText.optional(), kind: optText(30), pieces: qty.optional().nullable(), weight_kg: qty.optional().nullable(),
  condition: optText(30).nullable(), receiver_name: optText().nullable(), notes: optText(500).nullable(),
});
const handlingFields = z.object({
  ...common,
  occurred_at: dateText.optional(), location: optText(300),
  loaded_quantity: qty.optional(), weight_kg: qty.optional(),
  confirmed_by: optText(), photo_paths: paths.optional(),
  events: z.array(custodyLine).max(50).optional(),
});

const damageFields = z.object({
  ...common,
  exception_type: optText(40), affected_quantity: qty.optional(), description: optText(1000),
  photo_paths: paths.optional(), receiver_remarks: optText(1000),
  report_date: dateText.optional(), responsible_person: optText(),
  items: z.array(z.object({
    exception_code: optText(40).nullable(), type: optText(40).nullable(), pieces_affected: qty.optional().nullable(),
    weight_affected_kg: qty.optional().nullable(), condition: optText(30).nullable(), note: optText(500).nullable(),
  })).max(100).optional(),
});

const closureFields = z.object({
  ...common,
  final_delivery_status: optText(60), pod_reference: optText(60),
  final_freight: money.optional(), additional_charges: money.optional(), deductions_total: money.optional(),
  expenses: money.optional(), advance_paid: money.optional(), balance_payable: z.number().finite().optional(),
  closure_date: dateText.optional(), payment_status: optText(20),
  extra_charges: z.array(z.object({ label: text(120), amount: money, approved: z.boolean() })).max(100).optional(),
  deductions: z.array(z.object({ label: text(120), amount: money, reason: optText(300) })).max(100).optional(),
});

export const FIELD_SCHEMAS: Record<DocKind, z.ZodTypeAny> = {
  tax_invoice: invoiceFields,
  bill_of_supply: invoiceFields,
  delivery_challan: invoiceFields,
  eway_bill: ewayFields,
  lr: lrFields,
  freight_sheet: freightSheetFields,
  pod: podFields,
  loading_report: handlingFields,
  unloading_report: handlingFields,
  damage_report: damageFields,
  trip_closure: closureFields,
};

const fail = (e: z.ZodError): never => {
  const issue = e.issues[0];
  const where = issue.path.join('.');
  throw new HttpError(400, where ? `${where}: ${issue.message}` : issue.message);
};

/** The fields of a document of `kind`, validated and cleaned; a 400 naming the first problem otherwise. */
export function parseFields(kind: DocKind, raw: unknown): Record<string, any> {
  const parsed = FIELD_SCHEMAS[kind].safeParse(raw ?? {});
  if (!parsed.success) return fail(parsed.error);
  return parsed.data as Record<string, any>;
}

/** Parses a request body with a schema; a 400 naming the first problem. */
export function parseBody<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) return fail(parsed.error);
  return parsed.data;
}

const uuid = z.string().uuid();
const baseDoc = {
  number: z.string().trim().min(1).max(60).optional(),
  doc_date: dateText.optional(),
  fields: z.record(z.unknown()).optional(),
  file_path: z.string().trim().min(1).max(300).optional(),
  valid_until: dateText.optional(),
  shipment_id: uuid.optional(),
};

export const createDocumentBody = z.object({
  kind: z.enum(DOC_KINDS),
  status: z.enum(['draft', 'final']).optional(),
  supersedes: uuid.optional(),
  ...baseDoc,
});

export const updateDocumentBody = z.object({
  status: z.enum(DOC_STATUSES).optional(),
  ...baseDoc,
}).refine(b => Object.keys(b).length > 0, 'Nothing to update');

export const uploadUrlBody = z.object({
  kind: z.enum(DOC_KINDS),
  content_type: z.string().trim().max(100),
  size: z.number().int().positive(),
});

export const generateBody = z.object({
  /** Values the generated document should carry instead of the ones taken from the load. */
  overrides: z.record(z.unknown()).optional(),
  status: z.enum(['draft', 'final']).optional(),
}).optional().default({});

/** The identifying values of a document, checked after its fields are parsed. */
export interface NormalisedDocument {
  number: string | null;
  doc_date: string | null;
  valid_until: string | null;
  fields: Record<string, any>;
}

const NUMBER_REQUIRED: readonly DocKind[] = ['tax_invoice', 'bill_of_supply', 'delivery_challan'];

export function normaliseDocument(
  kind: DocKind,
  input: { number?: string | null; doc_date?: string | null; valid_until?: string | null; fields?: unknown },
): NormalisedDocument {
  const raw: Record<string, unknown> = { ...(input.fields as Record<string, unknown> | undefined) };
  // An e-way bill's number is its 12 digits; keep the two in step
  if (kind === 'eway_bill' && raw.ewb_number === undefined && input.number) raw.ewb_number = input.number;
  const fields = parseFields(kind, raw);
  let number = input.number ?? null;
  if (kind === 'eway_bill') {
    if (input.number && input.number !== fields.ewb_number) throw new HttpError(400, 'number must equal the e-way bill number');
    number = fields.ewb_number;
    if (!input.valid_until) throw new HttpError(400, 'valid_until is required for an e-way bill');
  }
  if (NUMBER_REQUIRED.includes(kind) && !number) throw new HttpError(400, 'number is required');
  return {
    number,
    doc_date: input.doc_date ? input.doc_date.slice(0, 10) : null,
    valid_until: input.valid_until ? new Date(input.valid_until).toISOString() : null,
    fields,
  };
}
