/**
 * margixindia — GST arithmetic in integer paise.
 *
 * Money on an invoice is added up in whole paise, never in floating-point rupees, so a total can
 * never carry a stray paisa. Rules:
 *   - the taxable value (before GST) is the one input;
 *   - each tax line (CGST and SGST, or IGST, or one GST line when the place of supply is not known)
 *     is worked out from the taxable value with a single rounding step (half up);
 *   - the total is the taxable value plus the tax lines, exactly.
 * For a price entered with GST already in it, `taxableFromInclusive` finds the taxable value whose
 * lines add back to the entered amount.
 */

/** GST state codes (the first two digits of a GSTIN). */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland',
  '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};

/** The state a GSTIN was issued in, from its first two digits. */
export const stateOf = (gstin: string | null | undefined) => {
  const code = gstin && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : null;
  return { code, name: code ? (GST_STATES[code] ?? null) : null };
};

/** The GST code of a state given by name ("Maharashtra"), ignoring case and extra spaces. */
export function stateCodeByName(name: string | null | undefined): string | null {
  const wanted = (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!wanted) return null;
  for (const [code, label] of Object.entries(GST_STATES)) if (label.toLowerCase() === wanted) return code;
  return null;
}

/** Rupees to whole paise. */
export const toPaise = (rupees: number): number => Math.round(rupees * 100 + (rupees < 0 ? -1e-7 : 1e-7));
/** Whole paise to rupees (two decimals exactly). */
export const fromPaise = (paise: number): number => paise / 100;

/** n / d rounded half up, for non-negative integers. */
const roundDiv = (n: number, d: number): number => Math.floor((2 * n + d) / (2 * d));

export type TaxBasis = 'intra' | 'inter' | 'unknown' | 'none';

export interface TaxLines {
  basis: TaxBasis;
  rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** One GST amount when the place of supply is not known (`unknown`). */
  gst: number;
  /** All tax lines added up. */
  tax: number;
  total: number;
}

/** CGST, SGST or IGST (or one GST amount) on a taxable value, all in paise. */
export function taxLines(taxablePaise: number, rate: number, basis: TaxBasis): TaxLines {
  const taxable = Math.round(taxablePaise);
  const out: TaxLines = { basis, rate, taxable, cgst: 0, sgst: 0, igst: 0, gst: 0, tax: 0, total: taxable };
  if (!(rate > 0) || basis === 'none') return { ...out, basis: 'none', rate: 0 };
  const hundredths = Math.round(rate * 100); // 18 -> 1800, 2.5 -> 250: a rate has at most 2 decimals
  if (basis === 'intra') {
    const half = roundDiv(taxable * hundredths, 20_000);
    out.cgst = half;
    out.sgst = half;
    out.tax = half * 2;
  } else if (basis === 'inter') {
    out.igst = roundDiv(taxable * hundredths, 10_000);
    out.tax = out.igst;
  } else {
    out.gst = roundDiv(taxable * hundredths, 10_000);
    out.tax = out.gst;
  }
  out.total = taxable + out.tax;
  return out;
}

/**
 * The taxable value for a price entered with GST included. The entered amount is divided by 1 + rate
 * and the tax lines are worked out from that; a neighbouring paisa is tried when it is the one that
 * makes the lines add back to the entered amount. `exact` is false when no taxable value can (some
 * amounts have no exact split), and then the closest total is returned.
 */
export function taxableFromInclusive(totalPaise: number, rate: number, basis: TaxBasis): TaxLines & { exact: boolean } {
  const target = Math.round(totalPaise);
  if (!(rate > 0) || basis === 'none') return { ...taxLines(target, 0, 'none'), exact: true };
  const estimate = Math.round((target * 100) / (100 + rate));
  let best: TaxLines | null = null;
  for (let delta = 0; delta <= 3; delta++) {
    for (const t of delta === 0 ? [estimate] : [estimate - delta, estimate + delta]) {
      const lines = taxLines(t, rate, basis);
      if (lines.total === target) return { ...lines, exact: true };
      if (!best || Math.abs(lines.total - target) < Math.abs(best.total - target)) best = lines;
    }
  }
  return { ...best!, exact: false };
}

/**
 * GST on freight (a goods transport agency): how a company charges it. The freight is taxed at the transporter's
 * rate, never at the rate of the goods it carries.
 *   rcm_5   reverse charge: the recipient pays 5%, so the invoice itself charges no GST (the default)
 *   fcm_5   forward charge, 5%, without input tax credit
 *   fcm_18  forward charge, 18%, with input tax credit
 */
export const GTA_GST_OPTIONS = ['rcm_5', 'fcm_5', 'fcm_18'] as const;
export type GtaGstOption = (typeof GTA_GST_OPTIONS)[number];
export const DEFAULT_GTA_GST_OPTION: GtaGstOption = 'rcm_5';
/** The SAC of goods transport by road. */
export const FREIGHT_SAC = '9965';

export const isGtaOption = (v: unknown): v is GtaGstOption => typeof v === 'string' && (GTA_GST_OPTIONS as readonly string[]).includes(v);

/** What the invoice charges, and what the recipient owes instead, for one option. */
export function gtaTerms(option: GtaGstOption): { rate: number; reverse_charge: boolean; reverse_charge_rate: number } {
  switch (option) {
    case 'fcm_5': return { rate: 5, reverse_charge: false, reverse_charge_rate: 0 };
    case 'fcm_18': return { rate: 18, reverse_charge: false, reverse_charge_rate: 0 };
    default: return { rate: 0, reverse_charge: true, reverse_charge_rate: 5 };
  }
}
