/**
 * A form a visitor filled in before signing in, kept in this browser only so it can be restored
 * after sign-in. Nothing is sent to the server. Every access is guarded: private windows and
 * blocked storage must never break the page.
 */

const PREFIX = 'margix:guest-draft:'
/** A draft older than this is dropped on read. */
export const GUEST_DRAFT_TTL_MS = 24 * 60 * 60 * 1000

/** What a draft is for. One slot per kind. */
export type GuestDraftKind = 'request' | 'bid'

interface Stored<T> { savedAt: number; data: T }

const keyFor = (kind: GuestDraftKind) => `${PREFIX}${kind}`

/** Saves the draft, replacing any earlier one of the same kind. Returns false when storage is unavailable. */
export function saveGuestDraft<T>(kind: GuestDraftKind, data: T, now: number = Date.now()): boolean {
  try {
    const stored: Stored<T> = { savedAt: now, data }
    localStorage.setItem(keyFor(kind), JSON.stringify(stored))
    return true
  } catch {
    return false
  }
}

/** The saved draft, or null when there is none, it is older than 24 hours, or it cannot be read. */
export function loadGuestDraft<T>(kind: GuestDraftKind, now: number = Date.now()): T | null {
  try {
    const raw = localStorage.getItem(keyFor(kind))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Stored<T>> | null
    if (!parsed || typeof parsed.savedAt !== 'number' || parsed.data === undefined || parsed.data === null) {
      clearGuestDraft(kind)
      return null
    }
    if (now - parsed.savedAt > GUEST_DRAFT_TTL_MS || parsed.savedAt > now + 60_000) {
      clearGuestDraft(kind)
      return null
    }
    return parsed.data
  } catch {
    return null
  }
}

/** Removes the draft. Safe to call when there is none. */
export function clearGuestDraft(kind: GuestDraftKind): void {
  try {
    localStorage.removeItem(keyFor(kind))
  } catch {
    /* nothing to clear */
  }
}
