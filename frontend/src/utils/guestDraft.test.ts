import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearGuestDraft, GUEST_DRAFT_TTL_MS, loadGuestDraft, saveGuestDraft } from './guestDraft'

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
    map,
  }
}

describe('guestDraft', () => {
  let store: ReturnType<typeof fakeStorage>
  beforeEach(() => {
    store = fakeStorage()
    vi.stubGlobal('localStorage', store)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('saves and loads by kind under margix:guest-draft:<kind>', () => {
    expect(saveGuestDraft('request', { weight: 500 })).toBe(true)
    expect(store.map.has('margix:guest-draft:request')).toBe(true)
    expect(loadGuestDraft('request')).toEqual({ weight: 500 })
    expect(loadGuestDraft('bid')).toBeNull()
  })

  it('clears one kind and leaves the other', () => {
    saveGuestDraft('request', { a: 1 })
    saveGuestDraft('bid', { b: 2 })
    clearGuestDraft('request')
    expect(loadGuestDraft('request')).toBeNull()
    expect(loadGuestDraft('bid')).toEqual({ b: 2 })
  })

  it('expires after 24 hours and removes the stale entry', () => {
    const t0 = 1_000_000
    saveGuestDraft('request', { a: 1 }, t0)
    expect(loadGuestDraft('request', t0 + GUEST_DRAFT_TTL_MS - 1)).toEqual({ a: 1 })
    expect(loadGuestDraft('request', t0 + GUEST_DRAFT_TTL_MS + 1)).toBeNull()
    expect(store.map.has('margix:guest-draft:request')).toBe(false)
  })

  it('ignores corrupt entries', () => {
    store.setItem('margix:guest-draft:request', '{not json')
    expect(loadGuestDraft('request')).toBeNull()
    store.setItem('margix:guest-draft:bid', JSON.stringify({ nope: true }))
    expect(loadGuestDraft('bid')).toBeNull()
  })

  it('never throws when storage is blocked', () => {
    const blocked = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    }
    vi.stubGlobal('localStorage', blocked)
    expect(saveGuestDraft('request', { a: 1 })).toBe(false)
    expect(loadGuestDraft('request')).toBeNull()
    expect(() => clearGuestDraft('request')).not.toThrow()
  })
})
