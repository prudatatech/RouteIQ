/**
 * margixindia — Shapes shared by the goods services (docs/load-posting-design.md section 1).
 */

export type LoadType = 'ftl' | 'ptl';
export type Severity = 'info' | 'warn';

export interface DraftItem {
  product_name?: string | null;
  hsn_code?: string | null;
  /** The rate the customer picked, when the HSN has several */
  gst_rate?: number | null;
  quantity?: number | null;
  unit?: string | null;
  weight_kg?: number | null;
  /** Rupees */
  declared_value?: number | null;
  handling?: string[] | null;
  is_hazmat?: boolean | null;
  is_perishable?: boolean | null;
}

export interface DraftPlace {
  city?: string | null;
  pincode?: string | null;
  /** GST state code; worked out from the pin code when missing */
  state_code?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** YYYY-MM-DD */
  date?: string | null;
}

export interface LoadDraft {
  items: DraftItem[];
  pickup?: DraftPlace | null;
  delivery?: DraftPlace | null;
  load_type?: LoadType | null;
  vehicle_class?: string | null;
  capacity_t?: number | null;
  special_handling?: string[] | null;
  /** Rupees */
  budget_inr?: number | null;
}

/** A product line once its HSN has been looked up. */
export interface GoodsLine {
  product: string;
  hsn: string | null;
  /** True when the HSN is in the master */
  hsn_known: boolean;
  /** The rate used: the chosen one, else the code's default; null when unknown */
  rate: number | null;
  /** Every rate the code allows */
  rates: number[];
  /** The HSN has several rates and the customer has not picked one */
  rate_ambiguous: boolean;
  weight_kg: number;
  /** Rupees */
  value: number;
  hazmat: boolean;
  perishable: boolean;
  eway_always: boolean;
  category: string | null;
  handling: string[];
}

export interface Recommendation {
  code: string;
  severity: Severity;
  message: string;
  action?: { field: string; value: string | number };
}

export interface TaxLine { product: string; hsn: string | null; rate: number; taxable: number; gst: number }
export interface TaxByRate { rate: number; taxable: number; gst: number }

export interface TaxSummary {
  basis: 'intra' | 'inter' | 'unknown';
  /** State names, for display */
  pickup_state: string | null;
  delivery_state: string | null;
  /** GST state codes ('27'), for storing */
  pickup_state_code?: string | null;
  delivery_state_code?: string | null;
  lines: TaxLine[];
  by_rate: TaxByRate[];
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  gst_total: number;
  grand_total: number;
}

export interface EwayRule { required: boolean; threshold: number; reason: string }

export interface Suggested { load_type: LoadType; vehicle_class: string | null; capacity_t: number | null }

export interface Estimate {
  low: number;
  high: number;
  distance_km: number;
  label: string;
}

export interface LoadAssessment {
  totals: { weight_kg: number; declared_value: number; product_count: number };
  eway: EwayRule;
  tax: TaxSummary;
  hazmat_mixed: boolean;
  perishable: boolean;
  suggested: Suggested;
  estimate: Estimate | null;
  recommendations: Recommendation[];
}
