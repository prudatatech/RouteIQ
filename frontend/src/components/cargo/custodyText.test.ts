import { describe, expect, it } from 'vitest'
import type { CustodyEvent } from '@/services/cargo'
import { dropRepeatedEvents, dropRepeatedSentences, tidyNote, uniqueTexts } from './custodyText'

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
