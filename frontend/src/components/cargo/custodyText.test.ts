import { describe, expect, it } from 'vitest'
import type { CaseTimelineEntry, CustodyEvent } from '@/services/cargo'
import { dropRepeatedEvents, dropRepeatedSentences, groupTimelineEntries, lotsText, tidyNote, uniqueTexts } from './custodyText'

const ev = (over: Partial<CustodyEvent>): CustodyEvent => ({
  id: 'e', kind: 'accepted', recorded_at: '2026-10-01T10:00:00Z', from_holder: null, to_holder: null,
  from_vehicle_id: null, to_vehicle_id: null, from_depot_id: null, to_depot_id: null, pieces: null, condition: null,
  receiver_name: null, otp_verified: null, photo_urls: [], signature_url: null, lat: null, lng: null, lot: null, ...over,
})

describe('tidyNote', () => {
  it('turns a raw trip id into a short code', () => {
    expect(tidyNote('Accepted route 874fa20d-8c18-47d6-ab70-a272f200e7ea')).toBe('Accepted TR-874FA20D')
  })
  it('is null for nothing', () => {
    expect(tidyNote('  ')).toBeNull()
    expect(tidyNote(null)).toBeNull()
  })
})

describe('dropRepeatedSentences', () => {
  it('keeps one of a repeated sentence', () => {
    expect(dropRepeatedSentences('Lot A: 50 of the 100 pieces. Lot A: 50 of the 100 pieces.')).toBe('Lot A: 50 of the 100 pieces.')
  })
  it('treats a repeat without its full stop as the same sentence', () => {
    expect(dropRepeatedSentences('Lot B: 25 of the 100 pieces (one lot per drop). Lot B: 25 of the 100 pieces (one lot per drop)')).toBe('Lot B: 25 of the 100 pieces (one lot per drop).')
  })
  it('keeps different sentences', () => {
    expect(dropRepeatedSentences('One. Two.')).toBe('One. Two.')
  })
  it('keeps one of a text written twice', () => {
    expect(dropRepeatedSentences('Lot A: 50 pieces Lot A: 50 pieces')).toBe('Lot A: 50 pieces')
  })
})

describe('uniqueTexts', () => {
  it('drops a repeat, ignoring case and blanks', () => {
    expect(uniqueTexts(['Same', null, 'same', 'Other'])).toEqual(['Same', 'Other'])
  })
})

describe('dropRepeatedEvents', () => {
  it('drops a straight repeat but keeps a later one after another event', () => {
    const a = ev({ id: '1', notes: 'Driver accepted the job' })
    const b = ev({ id: '2', notes: 'Driver accepted the job' })
    const c = ev({ id: '3', kind: 'delivery' as CustodyEvent['kind'] })
    expect(dropRepeatedEvents([a, b, c, ev({ id: '4', notes: 'Driver accepted the job' })]).map(e => e.id)).toEqual(['1', '3', '4'])
  })
})

describe('groupTimelineEntries', () => {
  const entry = (id: string, at: string, lot: string, pieces: number, over: Partial<CaseTimelineEntry> = {}): CaseTimelineEntry => ({
    id, at, source: 'custody', kind: 'pickup', title: 'Picked up', actor_name: 'Ravi', pieces, ref: { lot_label: lot }, ...over,
  })

  it('makes one entry per handover, naming the lots and their pieces', () => {
    const out = groupTimelineEntries([
      entry('1', '2026-10-01T10:00:00Z', 'A', 50),
      entry('2', '2026-10-01T10:00:20Z', 'B', 25),
      entry('3', '2026-10-01T12:00:00Z', 'A', 50, { kind: 'handover', title: 'Handed over' }),
    ])
    expect(out).toHaveLength(2)
    expect(out[0].lotLabels).toEqual(['A', 'B'])
    expect(out[0].piecesList).toEqual([50, 25])
    expect(lotsText(out[0].lotLabels)).toBe('Lots A and B')
  })

  it('keeps entries that are far apart, by someone else, or not custody', () => {
    expect(groupTimelineEntries([entry('1', '2026-10-01T10:00:00Z', 'A', 5), entry('2', '2026-10-01T10:30:00Z', 'B', 5)])).toHaveLength(2)
    expect(groupTimelineEntries([entry('1', '2026-10-01T10:00:00Z', 'A', 5), entry('2', '2026-10-01T10:00:10Z', 'B', 5, { actor_name: 'Sam' })])).toHaveLength(2)
    expect(groupTimelineEntries([entry('1', '2026-10-01T10:00:00Z', 'A', 5, { source: 'note' }), entry('2', '2026-10-01T10:00:10Z', 'B', 5, { source: 'note' })])).toHaveLength(2)
  })
})
