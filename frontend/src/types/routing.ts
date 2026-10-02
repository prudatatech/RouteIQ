/**
 * Order routing and quotes (docs/order-routing.md). A posted load is open to every company serving the lane
 * or sent to chosen companies; companies quote or accept; the vendor awards one.
 */

export type LoadRouting = 'open' | 'chosen'

/** Most companies a vendor can choose for one load. */
export const MAX_CHOSEN_COMPANIES = 10

export type QuoteStatus = 'submitted' | 'accepted' | 'declined' | 'withdrawn' | 'expired'

/** A quote as the vendor sees it (GET /vendor/loads/:id/quotes). */
export interface LoadQuote {
  id: string
  company_name: string
  /** The company's completed trips. */
  trips_completed: number
  amount_inr: number
  valid_until: string | null
  vehicle_class: string | null
  pickup_eta: string | null
  notes: string | null
  status: QuoteStatus
  created_at?: string
}

/** What the vendor's quotes call returns. The server may send a bare list; the API layer fills the rest. */
export interface LoadQuotesResult {
  quotes: LoadQuote[]
  /** When companies are expected to have quoted by; null when no quote was requested. */
  quote_deadline: string | null
  quote_requested: boolean
  /** Set once a company won the load. */
  awarded: { company_name: string; amount_inr: number; quote_id: string | null } | null
}

/** A company's own quote on a load. */
export interface MyQuote {
  id: string
  amount_inr: number
  valid_until: string | null
  vehicle_class: string | null
  pickup_eta: string | null
  notes: string | null
  status: QuoteStatus
}

export type MarketTab = 'new' | 'quoted' | 'won' | 'lost'

/** One row of the company's market (GET /company/loads/market?tab=). */
export interface MarketLoad {
  id: string
  load_number: string
  pickup_city: string
  delivery_city: string
  pickup_date: string | null
  weight_kg: number | null
  declared_value: number | null
  budget_inr: number | null
  quote_requested: boolean
  quote_deadline: string | null
  my_quote: MyQuote | null
}

export interface QuoteInput {
  amount_inr: number
  valid_until?: string
  vehicle_class?: string
  pickup_eta?: string
  notes?: string
}
