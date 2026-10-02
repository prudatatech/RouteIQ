/**
 * margixindia — Load assessment for posting.
 *
 * POST /vendor/loads recomputes totals, tax, e-way need and hazmat on the server with the same engine as
 * POST /public/loads/assist (services/goods), so what the form showed and what is stored can't drift apart.
 * The posting body is flat (pickup_pincode, ...); toNestedDraft turns it into the assistant's draft. No freight
 * estimate here: posting doesn't need one and it would call the routing services.
 */
import { assessLoad as assessGoods, LoadDraftSchema, toNestedDraft, type LoadDraft } from '../goods';
import type { LoadAssessment } from '../goods/types';
import { HttpError } from '../../core/errors';

export type { LoadAssessment, Recommendation } from '../goods/types';
export const EWAY_THRESHOLD_INR = 50_000;

export interface AssessItem {
  product_name?: string | null;
  hsn_code?: string | null;
  gst_rate?: number | null;
  weight_kg?: number | null;
  declared_value?: number | null;
  is_hazmat?: boolean | null;
  is_perishable?: boolean | null;
}

export interface LoadDraftLike {
  items: AssessItem[];
  pickup_pincode?: string | null;
  delivery_pincode?: string | null;
  pickup_state_code?: string | null;
  delivery_state_code?: string | null;
  pickup_date?: string | null;
  load_type?: string | null;
  vehicle_class?: string | null;
  capacity_t?: number | null;
  budget_inr?: number | null;
}

export async function assessLoad(draft: LoadDraftLike): Promise<LoadAssessment> {
  const parsed = LoadDraftSchema.safeParse(toNestedDraft(draft));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  return assessGoods(parsed.data as LoadDraft, { estimate: null });
}
