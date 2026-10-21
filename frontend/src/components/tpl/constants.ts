import { formatRupees } from '@/utils/display'
/** Documents a 3PL applicant or partner can upload; matches backend TPL_DOCUMENT_TYPES. */
export const TPL_DOCUMENT_TYPES = [
  'PAN Card',
  'GST Certificate',
  'Cancelled Cheque',
  'Certificate of Incorporation',
  'Partnership Deed',
  'Board Resolution / Letter of Authority',
  'Authorized Signatory ID',
  'Carriage by Road Registration',
  'MSME / Udyam Certificate',
  'Trade License / Shop & Establishment',
  'Sample Consignment Note (LR)',
] as const

export type TplDocType = (typeof TPL_DOCUMENT_TYPES)[number]

export type TplDocCategory = 'kyc' | 'constitution' | 'governance' | 'transport'

export interface TplDocCategoryInfo {
  id: TplDocCategory
  title: string
  subtitle: string
}

export const TPL_DOC_CATEGORIES: TplDocCategoryInfo[] = [
  { id: 'kyc', title: 'Core Financial & Tax KYC', subtitle: 'Essential tax identity and verified bank account for payouts' },
  { id: 'constitution', title: 'Business Constitution & Entity Proof', subtitle: 'Statutory registration verifying entity existence and structure' },
  { id: 'governance', title: 'Signatory Authorization & Governance', subtitle: 'Formal authorization binding the carrier entity to freight contracts' },
  { id: 'transport', title: 'Logistics & Regulatory Compliance', subtitle: 'Carriage by Road Act 2007, GTA standing, and MSME statutory credentials' },
]

export interface TplDocSpec {
  type: TplDocType
  label: string
  category: TplDocCategory
  hint: string
  alwaysRequired?: boolean
  evaluateRequirement: (ctx: {
    entityType?: string | null
    msmeStatus?: string | null
    authorizedSignatoryName?: string | null
  }) => {
    level: 'required' | 'recommended' | 'optional'
    badgeText: string
    reason?: string
  }
}

export const TPL_DOCUMENT_SPECS: Record<TplDocType, TplDocSpec> = {
  'PAN Card': {
    type: 'PAN Card',
    label: 'Company / Proprietor PAN Card',
    category: 'kyc',
    hint: 'Permanent Account Number of the company or proprietor',
    alwaysRequired: true,
    evaluateRequirement: () => ({
      level: 'required',
      badgeText: 'Mandatory',
      reason: 'Essential tax identity required for all carriers',
    }),
  },
  'GST Certificate': {
    type: 'GST Certificate',
    label: 'GST Registration Certificate',
    category: 'kyc',
    hint: 'Form GST REG-06 showing legal & trade name (all 3 pages)',
    evaluateRequirement: () => ({
      level: 'required',
      badgeText: 'Required for Invoicing',
      reason: 'Required for compliant GTA freight billing & Input Tax Credit',
    }),
  },
  'Cancelled Cheque': {
    type: 'Cancelled Cheque',
    label: 'Cancelled Cheque / Bank Proof',
    category: 'kyc',
    hint: 'Bank cheque or statement showing account name, number & IFSC',
    alwaysRequired: true,
    evaluateRequirement: () => ({
      level: 'required',
      badgeText: 'Mandatory for Payouts',
      reason: 'Direct RTGS/NEFT trip freight settlement verification',
    }),
  },
  'Certificate of Incorporation': {
    type: 'Certificate of Incorporation',
    label: 'Certificate of Incorporation (COI)',
    category: 'constitution',
    hint: 'Issued by Ministry of Corporate Affairs (MCA) / ROC with CIN',
    evaluateRequirement: ({ entityType }) => {
      const isCorporate = entityType === 'Private Limited' || entityType === 'Public Limited'
      return isCorporate
        ? { level: 'required', badgeText: 'Required for Companies', reason: 'Mandatory proof of incorporation for Private/Public Ltd' }
        : { level: 'optional', badgeText: 'For Registered Companies', reason: 'Optional for non-corporate entities' }
    },
  },
  'Partnership Deed': {
    type: 'Partnership Deed',
    label: 'Partnership Deed / LLP Agreement',
    category: 'constitution',
    hint: 'Executed partnership deed or registered LLP agreement',
    evaluateRequirement: ({ entityType }) => {
      const isPartnership = entityType === 'Partnership' || entityType === 'LLP'
      return isPartnership
        ? { level: 'required', badgeText: 'Required for Partnership / LLP', reason: 'Mandatory for partnership firms & LLPs' }
        : { level: 'optional', badgeText: 'For Partnership Firms', reason: 'Optional for non-partnership entities' }
    },
  },
  'Trade License / Shop & Establishment': {
    type: 'Trade License / Shop & Establishment',
    label: 'Trade License / Shop Act Certificate',
    category: 'constitution',
    hint: 'Local municipal trade license or Shop & Establishment certificate',
    evaluateRequirement: ({ entityType }) => {
      const isProp = entityType === 'Proprietorship'
      return isProp
        ? { level: 'recommended', badgeText: 'Recommended for Proprietorship', reason: 'Proof of commercial operating establishment' }
        : { level: 'optional', badgeText: 'Optional' }
    },
  },
  'Board Resolution / Letter of Authority': {
    type: 'Board Resolution / Letter of Authority',
    label: 'Board Resolution / Authorization Letter',
    category: 'governance',
    hint: 'Signed authorization on company letterhead empowering the signatory',
    evaluateRequirement: ({ entityType }) => {
      const needsPoa = entityType === 'Private Limited' || entityType === 'Public Limited' || entityType === 'LLP' || entityType === 'Partnership'
      return needsPoa
        ? { level: 'required', badgeText: 'Required for Corporate Signatory', reason: 'Legal authorization to accept loads and bind the carrier' }
        : { level: 'recommended', badgeText: 'Recommended', reason: 'Recommended if owner is represented by manager' }
    },
  },
  'Authorized Signatory ID': {
    type: 'Authorized Signatory ID',
    label: 'Authorized Signatory Photo ID',
    category: 'governance',
    hint: 'Aadhaar, Passport, or Voter ID of the designated signatory',
    evaluateRequirement: ({ authorizedSignatoryName }) => {
      return authorizedSignatoryName?.trim()
        ? { level: 'required', badgeText: 'Required for Signatory', reason: `Identity proof of ${authorizedSignatoryName.trim()}` }
        : { level: 'recommended', badgeText: 'Recommended', reason: 'Government photo ID of carrier representative' }
    },
  },
  'Carriage by Road Registration': {
    type: 'Carriage by Road Registration',
    label: 'Carriage by Road Registration (Common Carrier)',
    category: 'transport',
    hint: 'Common carrier certificate under Carriage by Road Act 2007 or STA/RTO permit',
    evaluateRequirement: () => ({
      level: 'recommended',
      badgeText: 'Carriage by Road Act 2007',
      reason: 'Essential certification for bona fide Goods Transport Agency (GTA) operations in India',
    }),
  },
  'MSME / Udyam Certificate': {
    type: 'MSME / Udyam Certificate',
    label: 'MSME / Udyam Registration Certificate',
    category: 'transport',
    hint: 'Official Udyam certificate issued by Ministry of MSME',
    evaluateRequirement: ({ msmeStatus }) => {
      const isMsme = msmeStatus && msmeStatus !== 'Not Registered'
      return isMsme
        ? { level: 'required', badgeText: 'Required (MSME Declared)', reason: 'Mandatory to claim Section 43B(h) and MSMED Act priority payment protections' }
        : { level: 'optional', badgeText: 'If MSME Registered', reason: 'Optional if business is not registered under MSME' }
    },
  },
  'Sample Consignment Note (LR)': {
    type: 'Sample Consignment Note (LR)',
    label: 'Sample Lorry Receipt (LR) / Consignment Note',
    category: 'transport',
    hint: 'Transporter copy of serially numbered Consignment Note format',
    evaluateRequirement: () => ({
      level: 'recommended',
      badgeText: 'GTA Standard (GST Act)',
      reason: 'Consignment Note issuance legally defines Goods Transport Agency standing under GST Law',
    }),
  },
}


export const SLA_COMMITMENT_OPTIONS = ['2 Hours', '4 Hours', '6 Hours', '12 Hours']

export const TAX_TREATMENT_OPTIONS = [
  '12% GTA (With ITC) - Forward Charge',
  '5% GTA (No ITC) - Reverse Charge',
]

/** MSME registration status on a 3PL application; matches backend TPL_MSME_OPTIONS. */
export const TPL_MSME_OPTIONS = ['Not Registered', 'Micro', 'Small', 'Medium']

export const CORRIDOR_PRIORITY_OPTIONS = [
  { value: '1', label: 'Priority 1 (first)' },
  { value: '2', label: 'Priority 2' },
  { value: '3', label: 'Priority 3 (backup)' },
]

/** Common lanes offered as suggestions in the corridor field (free text is still allowed). */
export const CORRIDOR_SUGGESTIONS = ['DEL-BOM', 'BOM-BLR', 'DEL-CCU', 'MAA-BLR', 'DEL-HYD', 'PNQ-BLR', 'AMD-BOM', 'DEL-MAA']

/** Common vehicle types offered as a multi-select in the corridor editor. */
export const VEHICLE_TYPE_SUGGESTIONS = [
  '32ft SXL', '32ft MXL', '24ft SXL', '20ft', '14ft Eicher',
  '17ft Eicher', '19ft Eicher', 'Tata Ace', 'Ashok Leyland Dost',
  'Bolero Pickup', '40ft Trailer', '40ft Flatbed', 'Refrigerated Van',
]

/** Split the comma-separated vehicle list stored on a corridor row. */
export function parseVehicleTypes(value: string): string[] {
  return value.split(',').map(v => v.trim()).filter(Boolean)
}

export type RateUnit = 'per_trip' | 'per_km'

export const RATE_UNIT_OPTIONS: { value: RateUnit; label: string }[] = [
  { value: 'per_trip', label: 'per trip' },
  { value: 'per_km', label: 'per km' },
]

/** One corridor & rate row in the onboarding form and the partner's settings tab. */
export interface CorridorFormRow {
  id: number
  name: string
  /** Comma-separated vehicle types. */
  vehicles: string
  /** The rate as a number typed by the partner (empty: they quote each load). */
  rate: string
  rate_unit: RateUnit
  /** An earlier free-text rate that is not a number. Shown and kept as written, never used to price a load. */
  legacy_rate?: string
  priority: string
}

export function emptyCorridorRow(): CorridorFormRow {
  return { id: Date.now() + Math.random(), name: '', vehicles: '', rate: '', rate_unit: 'per_trip', priority: '1' }
}

/** A corridor as the database returns it. */
export interface StoredCorridor {
  corridor_name: string
  vehicle_types?: string[] | string | null
  /** Readable rate text: "₹45,000 per trip" for a numeric rate, or the earlier free text. */
  proposed_rate?: string | null
  rate_amount?: number | string | null
  rate_unit?: RateUnit | null
  priority?: string | number | null
}


/** A rate as it is shown: numeric rates as amount and unit, older text as written, "Quoted per load" for none. */
export function rateText(amount: number | string | null | undefined, unit: RateUnit | null | undefined, legacy?: string | null): string {
  const n = Number(amount)
  if (amount != null && amount !== '' && Number.isFinite(n) && n > 0) {
    return `${formatRupees(n)} ${unit === 'per_km' ? 'per km' : 'per trip'}`
  }
  return legacy?.trim() || 'Quoted per load'
}

export const corridorRateText = (c: StoredCorridor) => rateText(c.rate_amount, c.rate_unit, c.proposed_rate)

/** A stored corridor as an editable form row. A rate that is not a number is carried as `legacy_rate`. */
export function corridorToFormRow(c: StoredCorridor, id: number): CorridorFormRow {
  const hasNumber = c.rate_amount != null && Number(c.rate_amount) > 0
  return {
    id,
    name: c.corridor_name,
    vehicles: Array.isArray(c.vehicle_types) ? c.vehicle_types.join(', ') : (c.vehicle_types || ''),
    rate: hasNumber ? String(Number(c.rate_amount)) : '',
    rate_unit: hasNumber && c.rate_unit ? c.rate_unit : 'per_trip',
    ...(!hasNumber && c.proposed_rate ? { legacy_rate: c.proposed_rate } : {}),
    priority: String(c.priority || '1'),
  }
}

/**
 * A corridor row saved in the browser before rates had a unit: a rate that is not a plain number
 * becomes the earlier text instead of a value that would be refused.
 */
export function normaliseDraftCorridor(row: Partial<CorridorFormRow> & { id: number; name: string }): CorridorFormRow {
  const rate = String(row.rate ?? '').trim()
  const isNumber = rate !== '' && Number.isFinite(Number(rate)) && Number(rate) > 0
  return {
    id: row.id,
    name: row.name,
    vehicles: row.vehicles ?? '',
    rate: isNumber ? rate : '',
    rate_unit: row.rate_unit === 'per_km' ? 'per_km' : 'per_trip',
    ...(row.legacy_rate ? { legacy_rate: row.legacy_rate } : rate && !isNumber ? { legacy_rate: rate } : {}),
    priority: row.priority ?? '1',
  }
}
