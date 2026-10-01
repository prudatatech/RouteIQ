import type { CustodyEvent } from '@/services/cargo'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
// vocab-ok: matches the old "route" word in stored history text
const TRIP_ID = new RegExp(`\\b(?:route|trip)\\s+(${UUID})\\b`, 'gi')

/** "Accepted route 874fa20d-8c18-…" becomes "Accepted trip 874FA20D": a person never reads a raw id. */
export function tidyNote(text: string | null | undefined): string | null {
  if (!text) return null
  const out = text.replace(TRIP_ID, (_m, id: string) => `trip ${id.slice(0, 8).toUpperCase()}`).trim()
  return out || null
}

/** Drops a sentence that is repeated straight after itself ("Lot A: 50 of 100. Lot A: 50 of 100." keeps one). */
export function dropRepeatedSentences(text: string | null | undefined): string | null {
  if (!text) return null
  const parts = text.trim().split(/(?<=[.!?])\s+/)
  const kept = parts.filter((p, i) => i === 0 || p.trim().toLowerCase() !== parts[i - 1].trim().toLowerCase())
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
