/**
 * Organisations for the tenancy tests: the platform, two logistic companies, a vendor and a 3PL partner,
 * and the people who belong to them. `orgWorld()` returns table fixtures to pass to supabaseMock.reset.
 */
import { createHash } from 'node:crypto';
import { supabaseMock, type Row } from './mock-supabase';

/** A stable uuid for a person's short name ('admin-a'), so the API's id checks pass. */
export const uid = (key: string): string => `10000000-0000-4000-8000-${createHash('sha1').update(key).digest('hex').slice(0, 12)}`;

export const ORG = {
  platform: 'a0000000-0000-4000-8000-0000000000a0',
  companyA: 'a0000000-0000-4000-8000-0000000000a1',
  companyB: 'a0000000-0000-4000-8000-0000000000b2',
  vendorV: 'a0000000-0000-4000-8000-0000000000c3',
  tplT: 'a0000000-0000-4000-8000-0000000000d4',
} as const;

const org = (id: string, kind: string, name: string, status = 'active'): Row => ({ id, kind, name, status, profile: {}, created_at: '2026-10-01T00:00:00Z' });

export const ORGS: Row[] = [
  org(ORG.platform, 'platform', 'MargixIndia'),
  org(ORG.companyA, 'logistic_company', 'Alpha Logistics'),
  org(ORG.companyB, 'logistic_company', 'Beta Freight'),
  org(ORG.vendorV, 'vendor', 'Acme Traders'),
  org(ORG.tplT, 'tpl_partner', 'Tiny Transport'),
];

export interface Seat { user: string; org: keyof typeof ORG; role: string; status?: string }

/** The people: id, app role, and the organisations they sit in. */
export const PEOPLE: Array<{ id: string; role: string; name: string; email: string; phone?: string }> = [
  { id: 'super-1', role: 'superadmin', name: 'Sue Super', email: 'sue@example.test' },
  { id: 'admin-a', role: 'admin', name: 'Asha Alpha', email: 'asha@example.test' },
  { id: 'manager-a', role: 'manager', name: 'Manoj Alpha', email: 'manoj@example.test' },
  { id: 'admin-b', role: 'admin', name: 'Bela Beta', email: 'bela@example.test' },
  { id: 'driver-a', role: 'driver', name: 'Ravi Alpha', email: 'ravi@example.test', phone: '+919876500001' },
  { id: 'driver-b', role: 'driver', name: 'Sunil Beta', email: 'sunil@example.test', phone: '+919876500002' },
  { id: 'vendor-1', role: 'vendor', name: 'Vik Vendor', email: 'vik@example.test' },
  { id: 'tpl-1', role: 'vendor', name: 'Tina Tpl', email: 'tina@example.test' },
  { id: 'loner', role: 'admin', name: 'Lone Admin', email: 'loner@example.test' },
];

export const SEATS: Seat[] = [
  { user: 'super-1', org: 'platform', role: 'owner' },
  { user: 'super-1', org: 'companyA', role: 'owner' },
  { user: 'admin-a', org: 'companyA', role: 'admin' },
  { user: 'manager-a', org: 'companyA', role: 'ops' },
  { user: 'driver-a', org: 'companyA', role: 'driver' },
  { user: 'admin-b', org: 'companyB', role: 'owner' },
  { user: 'driver-b', org: 'companyB', role: 'driver' },
  { user: 'vendor-1', org: 'vendorV', role: 'owner' },
  { user: 'tpl-1', org: 'tplT', role: 'owner' },
];

export const orgById = (id: string): Row => ORGS.find(o => o.id === id)!;

/** An org_members row as the API reads it (with the organisation embedded). */
export const memberRow = (s: Seat): Row => ({
  org_id: ORG[s.org], user_id: uid(s.user), role: s.role, status: s.status ?? 'active', created_at: '2026-10-01T00:00:00Z',
  organizations: orgById(ORG[s.org]),
});

/** The settings that say organisations are set up. */
export const ORG_SETTINGS: Row[] = [
  { key: 'default_company_org_id', value: { value: ORG.companyA } },
  { key: 'platform_org_id', value: { value: ORG.platform } },
];

/** Table fixtures: organisations configured, people and their seats. `over` replaces or adds tables. */
export function orgWorld(over: Record<string, Row[]> = {}, opts: { configured?: boolean; seats?: Seat[] } = {}): Record<string, Row[]> {
  return {
    users: PEOPLE.map(p => ({ id: uid(p.id), role: p.role, full_name: p.name, email: p.email, phone: p.phone ?? null, is_active: true })),
    organizations: ORGS.map(o => ({ ...o })),
    org_members: (opts.seats ?? SEATS).map(memberRow),
    tpl_affiliations: [],
    system_settings: opts.configured === false ? [] : ORG_SETTINGS.map(r => ({ ...r })),
    notifications: [],
    ai_agent_logs: [],
    ...over,
  };
}

export const as = (user: string, orgId?: string) => ({
  Authorization: `Bearer ${supabaseMock.signUserToken(uid(user))}`,
  ...(orgId ? { 'X-Org-Id': orgId } : {}),
});
