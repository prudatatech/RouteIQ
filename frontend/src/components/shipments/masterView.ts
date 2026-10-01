/**
 * What a split master shows. A master holds no goods, so it has no vehicle, driver or drop of its
 * own: they are read from its lots (`lots_summary`). Also the status history shown on a shipment:
 * repeated entries folded, and a status worked out from the lots not called a failed delivery.
 * Pure rules, covered by masterView.test.ts.
 */
import { needsEwayBill } from '@/config/compliance'
import type { ShipmentHistoryEvent, ShipmentRow } from './types'

type SummaryLot = NonNullable<ShipmentRow['lots_summary']>['lots'][number]

const liveLots = (s: Pick<ShipmentRow, 'lots_summary'>): SummaryLot[] => s.lots_summary?.lots ?? []

export interface LotCarrier {
  plate: string
  driver: string | null
  /** Lot labels this vehicle carries: A, B, C. */
  labels: string[]
}

/** The vehicles and drivers of a master's lots, one entry per vehicle and driver, in lot order. */
export function lotCarriers(s: Pick<ShipmentRow, 'lots_summary'>): LotCarrier[] {
  const out: LotCarrier[] = []
  for (const lot of liveLots(s)) {
    if (!lot.plate_number) continue
    const driver = lot.driver_name?.trim() || null
    const label = lot.label ?? lot.code
    const same = out.find(c => c.plate === lot.plate_number && c.driver === driver)
    if (same) same.labels.push(label)
    else out.push({ plate: lot.plate_number, driver, labels: [label] })
  }
  return out
}

/** "JH10AL0303 · MUNNA (A, B, C)" */
export function carrierText(c: LotCarrier): string {
  return `${c.plate}${c.driver ? ` · ${c.driver}` : ''} (${c.labels.join(', ')})`
}

/** The places a master's lots drop at, each once, in lot order. */
export function masterDrops(s: Pick<ShipmentRow, 'lots_summary'>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const lot of liveLots(s)) {
    const drop = lot.drop?.trim()
    if (drop && !seen.has(drop.toLowerCase())) {
      seen.add(drop.toLowerCase())
      out.push(drop)
    }
  }
  return out
}

/** "3 drops" for a master with several, the one place for a master with one, null when its lots have none on record. */
export function masterDestinationText(s: Pick<ShipmentRow, 'lots_summary'>): { headline: string; detail: string | null } | null {
  const drops = masterDrops(s)
  if (drops.length === 0) return null
  if (drops.length === 1) return { headline: drops[0], detail: null }
  return { headline: `${drops.length.toLocaleString('en-IN')} drops`, detail: drops.join(', ') }
}

/**
 * Whether an e-way bill is missing: a shipment or lot over the threshold with no number. A master
 * is missing it when it is over the threshold and neither it nor all of its lots have a number.
 */
export function missingEwayBill(s: Pick<ShipmentRow, 'declared_value' | 'eway_bill_ref' | 'is_master' | 'lots_summary'>): boolean {
  if (!needsEwayBill(s.declared_value, s.eway_bill_ref)) return false
  if (s.is_master) {
    const lots = liveLots(s)
    return !(lots.length > 0 && lots.every(l => (l.eway_bill_ref ?? '').trim()))
  }
  return true
}

export interface HistoryEntry {
  status: string
  at: string
  actor: ShipmentHistoryEvent['actor']
  note: string | null
  /** The words for the status, when they are not the usual ones. */
  label?: string
}

/** Entries of the same status, by the same person and note, this close are one entry: a split writes the status again. */
const SAME_ENTRY_WINDOW_MS = 2 * 60_000

/**
 * The status history as staff read it: identical entries one after another are shown once, and a
 * master's status worked out from its lots ("Delivery failed" when a lot has an open problem) is
 * named for what it is. A real failed attempt keeps "Delivery failed" and its note.
 */
export function historyEntries(events: ShipmentHistoryEvent[]): HistoryEntry[] {
  const out: HistoryEntry[] = []
  for (const e of events) {
    const exception = e.status === 'exception'
    const entry: HistoryEntry = {
      status: e.status,
      at: e.at,
      actor: e.actor,
      note: exception && e.rollup ? 'A lot has an open problem' : exception ? [e.note, 'Delivery attempt failed'].filter(Boolean).join(' · ') : e.note,
      ...(exception && e.rollup ? { label: 'Problem on a lot' } : {}),
    }
    const prev = out[out.length - 1]
    const same = prev
      && prev.status === entry.status
      && prev.note === entry.note
      && (prev.actor?.id ?? null) === (entry.actor?.id ?? null)
      && Math.abs(Date.parse(entry.at) - Date.parse(prev.at)) <= SAME_ENTRY_WINDOW_MS
    if (!same) out.push(entry)
  }
  return out
}
