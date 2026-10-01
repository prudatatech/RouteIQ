import type { CaseTimelineEntry, CustodyEvent } from '@/services/cargo'
import { tripNumber } from '@/utils/display'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
// vocab-ok: matches the old "route" word in stored history text
const TRIP_ID = new RegExp(`\\b(?:route|trip)\\s+(${UUID})\\b`, 'gi')

/** "Accepted route 874fa20d-8c18-…" becomes "Accepted trip 874FA20D": a person never reads a raw id. */
export function tidyNote(text: string | null | undefined): string | null {
  if (!text) return null
  const out = text.replace(TRIP_ID, (_m, id: string) => tripNumber(id)).trim()
  return out || null
}

/** Drops a sentence that is repeated straight after itself ("Lot A: 50 of 100. Lot A: 50 of 100." keeps one). */
export function dropRepeatedSentences(text: string | null | undefined): string | null {
  if (!text) return null
  const parts = text.trim().split(/(?<=[.!?])\s+/)
  // A full stop at the end does not make a sentence another one
  const same = (a: string, b: string) => a.trim().replace(/[.!?]+$/, '').toLowerCase() === b.trim().replace(/[.!?]+$/, '').toLowerCase()
  const kept = parts.filter((p, i) => i === 0 || !same(p, parts[i - 1]))
  const joined = kept.join(' ')
  // The same text written twice with no full stop between: "X X"
  const half = Math.floor(joined.length / 2)
  const a = joined.slice(0, half).trim()
  const b = joined.slice(half).trim()
  return a && a.toLowerCase() === b.toLowerCase() ? a : joined
}

/** Keeps the first of each text, ignoring case: a line that repeats another is dropped. */
export function uniqueTexts(parts: (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    const t = p?.trim()
    if (!t) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

const signature = (e: CustodyEvent) => [
  e.kind, e.lot?.label ?? '', e.from_holder ?? '', e.to_holder ?? '', e.from_vehicle_id ?? '', e.to_vehicle_id ?? '',
  e.pieces ?? '', e.condition ?? '', tidyNote(dropRepeatedSentences(e.summary ?? e.notes)) ?? '',
].join('|')

/**
 * Drops an event that says the same as the one before it (same kind, lot, holders, count and text),
 * as when a driver accepts the same job twice. Oldest first in and out.
 */
export function dropRepeatedEvents(events: CustodyEvent[]): CustodyEvent[] {
  const out: CustodyEvent[] = []
  for (const e of events) {
    const prev = out[out.length - 1]
    if (prev && signature(prev) === signature(e)) continue
    out.push(e)
  }
  return out
}

/** How many of the latest events a long history shows before "Show all". */
export const HISTORY_PREVIEW = 5

/** Entries this close, of the same kind by the same person, are one handover (each lot writes its own). */
const HANDOVER_WINDOW_MS = 2 * 60_000

export interface GroupedTimelineEntry extends CaseTimelineEntry {
  /** The lots the handover covered, in order, when it covered more than one. */
  lotLabels: string[]
  /** Pieces of each, in the same order, when known. */
  piecesList: number[]
}

/**
 * A case's timeline with one entry per handover. A split consignment writes the same step once per lot
 * ("Picked up" for lot A, then for lot B, seconds apart); those become one entry that names its lots
 * and lists the pieces and notes once. Oldest first in and out; only custody entries are grouped.
 */
export function groupTimelineEntries(entries: CaseTimelineEntry[]): GroupedTimelineEntry[] {
  const sorted = [...entries].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  const out: GroupedTimelineEntry[] = []
  for (const e of sorted) {
    const prev = out[out.length - 1]
    const same = !!prev && e.source === 'custody' && prev.source === 'custody'
      && prev.kind === e.kind
      && (prev.title ?? '') === (e.title ?? '')
      && (prev.actor_name ?? '') === (e.actor_name ?? '')
      && Math.abs(new Date(e.at).getTime() - new Date(prev.at).getTime()) <= HANDOVER_WINDOW_MS
    if (prev && same) {
      const lot = e.ref?.lot_label
      if (lot && !prev.lotLabels.includes(lot)) {
        if (prev.lotLabels.length === 0 && prev.ref?.lot_label) {
          prev.lotLabels.push(prev.ref.lot_label)
          if (prev.pieces != null) prev.piecesList.push(prev.pieces)
        }
        prev.lotLabels.push(lot)
        if (e.pieces != null) prev.piecesList.push(e.pieces)
      }
      prev.note = uniqueTexts([prev.note, e.note]).join(' ') || null
      prev.photo_urls = [...(prev.photo_urls ?? []), ...(e.photo_urls ?? [])]
      continue
    }
    out.push({ ...e, lotLabels: [], piecesList: [] })
  }
  return out
}

/** "Lots A and B", "Lots A, B and C". */
export function lotsText(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ? `Lot ${labels[0]}` : ''
  return `Lots ${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}
