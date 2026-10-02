import type { Membership } from './orgs'

/**
 * Which screen an organisation's user sees, decided from the active organisation alone.
 *  - `loading`   memberships not read yet
 *  - `open`      the normal screens (no organisation yet, an active one, the platform, or an older backend)
 *  - `waiting`   the organisation is pending or was rejected: only the "Waiting for approval" screen
 *  - `suspended` the organisation is suspended: only a notice
 */
export type OrgGate = 'loading' | 'open' | 'waiting' | 'suspended'

export function gateFor(loaded: boolean, active: Membership | null): OrgGate {
  if (!loaded) return 'loading'
  if (!active || active.org.kind === 'platform') return 'open'
  if (active.org.status === 'pending' || active.org.status === 'rejected') return 'waiting'
  if (active.org.status === 'suspended') return 'suspended'
  return 'open'
}

/** The platform owner's view: the active organisation is the live platform one and the user is its owner or admin. */
export function isPlatformActor(active: Membership | null): boolean {
  return !!active && active.org.kind === 'platform' && active.org.status === 'active' && (active.role === 'owner' || active.role === 'admin')
}

/** Menu variant: the Platform section only for the platform owner. */
export type Actor = 'platform' | 'company'
export const actorFor = (active: Membership | null): Actor => (isPlatformActor(active) ? 'platform' : 'company')

/** Where a path may be opened by this actor: /platform/* is for the platform owner only. */
export function canOpenPath(pathname: string, active: Membership | null): boolean {
  if (pathname === '/platform' || pathname.startsWith('/platform/')) return isPlatformActor(active)
  return true
}

/**
 * Where to send someone right after sign-in who has no area by role: the waiting screen when their
 * organisation is not approved yet, else null (the caller keeps its own rule).
 */
export function destinationForOrgs(memberships: Membership[], activeId: string | null): string | null {
  const active = memberships.find(m => m.org.id === activeId) ?? memberships[0] ?? null
  const gate = gateFor(true, active)
  return gate === 'waiting' || gate === 'suspended' ? '/waiting-for-approval' : null
}

/** What the waiting screen should tell the user, from the organisation's status and stored reason. */
export function waitingCopy(status: string, reason?: string | null): { title: string; body: string; reason: string | null } {
  if (status === 'rejected') {
    return {
      title: 'Your registration was not approved',
      body: 'You can correct your details and send them again, or contact support if you need help.',
      reason: reason?.trim() || null,
    }
  }
  if (status === 'suspended') {
    return { title: 'Your company is suspended', body: 'Contact support to find out why and how to restore access.', reason: reason?.trim() || null }
  }
  return {
    title: 'Waiting for approval',
    body: 'We have your registration. The MargixIndia team checks the details and approves your company, usually within one working day. We will tell you here and in your notifications.',
    reason: null,
  }
}

/** The switcher's option text: the name, with the status in brackets while the organisation is not working (an option cannot hold a badge). */
export function orgOptionLabel(m: Membership): string {
  if (m.org.status === 'pending') return `${m.org.name} (pending)`
  if (m.org.status === 'suspended') return `${m.org.name} (suspended)`
  if (m.org.status === 'rejected') return `${m.org.name} (rejected)`
  return m.org.name
}
