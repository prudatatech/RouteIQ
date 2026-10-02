/**
 * Request bodies for load posting (docs/load-posting-design.md section 2) and the vendor business profile.
 * Messages are written for the person who filled the form. `parseBody` (schemas/vendor.ts) turns the first
 * failure into a 400.
 */
import { z } from 'zod';
import { indianDateKey } from '../core/istDate';
import { validPlace } from '../core/places';
import { normalizeIndianMobile } from '../utils/phone';

export const MAX_LOAD_ITEMS = 50;
export const MAX_LOAD_TONNES = 60;
export const MAX_BULK_ROWS = 50;

const text = (label: string, max: number) => z.string().trim().min(1, `Enter ${label}`).max(max, `${label} is too long`);
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform(v => v || null);
const pincode = (label: string) => z.string().trim().regex(/^\d{6}$/, `${label} pin code must be 6 digits`);
const isoDate = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a date (YYYY-MM-DD)`)
  .refine(v => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), `${label} is not a real date`);
/** An Indian mobile, stored as +91XXXXXXXXXX. Blank means none. */
const phoneField = z.string().trim().optional().nullable().transform((v, ctx) => {
  if (!v) return null;
  const phone = normalizeIndianMobile(v);
  if (!phone) ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit Indian mobile number' });
  return phone;
});
const num = (label: string) => z.number({ invalid_type_error: `${label} must be a number`, required_error: `Enter ${label}` });

export const TEMP_MODES = ['chilled', 'frozen', 'ambient', 'custom'] as const;
export type TempMode = (typeof TEMP_MODES)[number];

export const HANDLING = ['fragile', 'do_not_stack', 'this_side_up', 'hazmat', 'odc', 'temperature_controlled'] as const;

export const LoadItemSchema = z.object({
  product_name: text('the product name', 200),
  hsn_code: z.string().trim().regex(/^\d{4}(\d{2}(\d{2})?)?$/, 'HSN code must be 4, 6 or 8 digits'),
  gst_rate: num('the GST rate').min(0, 'GST rate cannot be negative').max(40, 'GST rate is too high'),
  quantity: num('the quantity').positive('Quantity must be more than 0').max(1e9, 'Quantity is too large'),
  unit: text('the unit', 20),
  weight_kg: num('the weight').positive('Weight must be more than 0 kg').max(MAX_LOAD_TONNES * 1000, `A load can be at most ${MAX_LOAD_TONNES} t`),
  declared_value: num('the declared value').min(0, 'Declared value cannot be negative').max(1e10, 'Declared value is too large'),
  handling: z.array(z.string().trim().min(1).max(40)).max(10).optional().default([]),
  category: optText(80),
  is_hazmat: z.boolean().optional().default(false),
  is_perishable: z.boolean().optional().default(false),
});
export type LoadItemInput = z.infer<typeof LoadItemSchema>;

const todayOrLater = (v: string) => v >= indianDateKey(new Date());

/** The fields of a load, before the cross-field checks (the bulk rows reuse them). */
export const LoadDraftBase = z.object({
  client_request_id: z.string().uuid('client_request_id must be a UUID').optional(),
  source: z.enum(['web', 'app', 'bulk', 'api', 'repost']).optional(),
  items: z.array(LoadItemSchema).min(1, 'Add at least one product').max(MAX_LOAD_ITEMS, `A load can have at most ${MAX_LOAD_ITEMS} products`),

  pickup_city: text('the pickup city', 100),
  pickup_address: text('the pickup address', 500),
  pickup_pincode: pincode('Pickup'),
  pickup_state_code: z.string().regex(/^\d{2}$/).optional().nullable(),
  pickup_lat: num('the pickup location').min(-90).max(90),
  pickup_lng: num('the pickup location').min(-180).max(180),
  pickup_date: isoDate('Pickup date').refine(todayOrLater, 'Pickup date cannot be in the past'),
  pickup_slot: z.enum(['morning', 'afternoon', 'evening']).optional().nullable(),
  pickup_contact_name: optText(100),
  pickup_contact_phone: phoneField,

  delivery_city: text('the delivery city', 100),
  delivery_address: text('the delivery address', 500),
  delivery_pincode: pincode('Delivery'),
  delivery_state_code: z.string().regex(/^\d{2}$/).optional().nullable(),
  delivery_lat: num('the delivery location').min(-90).max(90),
  delivery_lng: num('the delivery location').min(-180).max(180),
  delivery_date: isoDate('Delivery date').optional().nullable(),
  delivery_contact_name: optText(100),
  delivery_contact_phone: phoneField,

  loading_dock: z.boolean().optional().nullable(),
  access_restrictions: optText(500),

  load_type: z.enum(['ftl', 'ptl']).optional().nullable(),
  vehicle_class: optText(40),
  capacity_t: z.number().positive().max(MAX_LOAD_TONNES).optional().nullable(),
  /** How a perishable load is kept: chilled, frozen, ambient (no range needed) or a custom range. */
  temp_mode: z.enum(TEMP_MODES).optional().nullable(),
  temp_min_c: z.number().min(-50).max(60).optional().nullable(),
  temp_max_c: z.number().min(-50).max(60).optional().nullable(),
  special_handling: z.array(z.string().trim().min(1).max(40)).max(10).optional().default([]),
  budget_inr: z.number().min(0).max(1e9).optional().nullable(),
  quote_requested: z.boolean().optional().default(false),
  loading_help: z.boolean().optional().default(false),
  unloading_help: z.boolean().optional().default(false),
  /** The companies chosen to receive the load; stored now, routed to them in Phase 3. */
  company_ids: z.array(z.string().uuid('A chosen company is not valid')).max(20).optional().default([]),
  reposted_from: z.string().uuid().optional().nullable(),
});

type Draft = z.infer<typeof LoadDraftBase>;

/** Checks that need more than one field. Each returns a message, or null. */
export function crossChecks(d: Draft): string | null {
  const totalKg = d.items.reduce((s, i) => s + i.weight_kg, 0);
  if (totalKg > MAX_LOAD_TONNES * 1000) return `A load can be at most ${MAX_LOAD_TONNES} t`;
  if (!validPlace(d.pickup_lat, d.pickup_lng) || !validPlace(d.delivery_lat, d.delivery_lng)) return 'Choose a real pickup and delivery place';
  if (d.delivery_date && d.delivery_date < d.pickup_date) return 'Delivery date cannot be before the pickup date';
  if (d.items.some(i => i.is_perishable)) {
    const hasRange = d.temp_min_c != null && d.temp_max_c != null;
    if (!d.temp_mode && !hasRange) return 'Choose the temperature mode for perishable goods: chilled, frozen, ambient or a custom range';
    if (d.temp_mode && d.temp_mode !== 'ambient' && !hasRange) return 'Enter the temperature range for perishable goods';
  }
  if (d.temp_min_c != null && d.temp_max_c != null && d.temp_min_c > d.temp_max_c) return 'The lowest temperature is above the highest';
  return null;
}

export const LoadDraftSchema = LoadDraftBase.superRefine((d, ctx) => {
  const problem = crossChecks(d);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
});
export type LoadDraftInput = z.infer<typeof LoadDraftSchema>;

export const LoadsMineQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  page_size: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z.string().trim().max(30).optional(),
});

// ── Business profile (section 9) ────────────────────────────

export const BUSINESS_TYPES = ['manufacturer', 'trader', 'distributor', 'retailer', 'exporter', 'other'] as const;
export const MONTHLY_LOADS = ['1-5', '6-20', '21-50', '50+'] as const;

export const BusinessProfileSchema = z.object({
  full_name: text('your full name', 100),
  business_name: text('your business name', 200),
  account_type: z.enum(['customer', 'business_partner'], { errorMap: () => ({ message: 'Choose the account type' }) }),
  gstin: z.string().trim().toUpperCase().max(15).optional().nullable().transform(v => v || null),
  address: text('the address', 500),
  pincode: pincode('Business'),
  state_code: z.string().regex(/^\d{2}$/).optional().nullable(),
  /** Optional, but the only channel for documents when there is no WhatsApp. */
  email: z.string().trim().toLowerCase().optional().nullable().transform(v => v || null)
    .refine(v => v === null || z.string().email().safeParse(v).success, 'Enter a valid email address'),
  business_type: z.enum(BUSINESS_TYPES).optional().nullable(),
  monthly_loads: z.enum(MONTHLY_LOADS).optional().nullable(),
}).superRefine((v, ctx) => {
  if (v.account_type === 'business_partner') {
    if (!v.gstin) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'GSTIN is required for a business account', path: ['gstin'] });
  }
});
export type BusinessProfileInput = z.infer<typeof BusinessProfileSchema>;
