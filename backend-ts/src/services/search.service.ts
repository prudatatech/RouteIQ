/**
 * margixindia — Global search (staff only)
 *
 * Looks up tracking IDs, cargo manifest ids, plates, drivers, vendors and 3PL
 * partners so staff can jump straight to a record (D1 in docs/ux-plan-2.md).
 *
 * Filtering is done in application code rather than with PostgREST `ilike`:
 * the project's mock Supabase test client (backend-ts/test/support/mock-supabase.ts)
 * does not implement `ilike`/`or` filtering, so a query built that way cannot
 * be verified by a test — it would always return the whole table. Each table
 * is fetched ordered by recency and capped at a bounded candidate size, then
 * matched case-insensitively in JS. This keeps behaviour identical against
 * the mock and the real database, and keeps the query cheap.
 */
import { supabase } from '../core/supabase';
import { manifestParcelCode } from '../core/parcelCode';

export interface SearchResultItem {
  id: string;
  label: string;
  sublabel?: string;
  type: string;
  path: string;
}

export interface SearchResults {
  shipments: SearchResultItem[];
  cargo_manifests: SearchResultItem[];
  vehicles: SearchResultItem[];
  vendors: SearchResultItem[];
  partners: SearchResultItem[];
  users: SearchResultItem[];
}

const CANDIDATE_LIMIT = 200;
const RESULT_LIMIT = 5;

/** Case-insensitive substring match; a missing field never matches. */
function includesTerm(value: unknown, term: string): boolean {
  return typeof value === 'string' && value.toLowerCase().includes(term);
}

function anyIncludes(term: string, ...values: unknown[]): boolean {
  return values.some(v => includesTerm(v, term));
}

const CM_PREFIX_RE = /^CM-([0-9A-F]+)$/i;

async function searchShipments(term: string): Promise<SearchResultItem[]> {
  const { data, error } = await supabase
    .from('shipments')
    .select('id, tracking_id, status, origin_name, origin_address, created_at')
    .order('created_at', { ascending: false })
    .limit(CANDIDATE_LIMIT);
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const byId = new Map<string, SearchResultItem>();
  for (const s of rows) {
    if (anyIncludes(term, s.tracking_id, s.origin_name, s.origin_address)) {
      byId.set(s.id, {
        id: s.id,
        label: s.tracking_id ?? s.id,
        sublabel: [s.status, s.origin_name || s.origin_address].filter(Boolean).join(' · '),
        type: 'shipment',
        path: `/shipments?open=${s.id}`,
      });
    }
  }

  if (byId.size < RESULT_LIMIT) {
    const { data: points, error: pointsErr } = await supabase
      .from('delivery_points')
      .select('id, name, address, shipment_id, created_at')
      .order('created_at', { ascending: false })
      .limit(CANDIDATE_LIMIT);
    if (pointsErr) throw new Error(pointsErr.message);

    const matchedShipmentIds = new Set<string>();
    for (const p of points ?? []) {
      if (!p.shipment_id || byId.has(p.shipment_id)) continue;
      if (anyIncludes(term, p.name, p.address)) matchedShipmentIds.add(p.shipment_id);
    }
    if (matchedShipmentIds.size > 0) {
      const shipmentById = new Map(rows.map(s => [s.id, s]));
      for (const id of matchedShipmentIds) {
        const s = shipmentById.get(id);
        byId.set(id, {
          id,
          label: s?.tracking_id ?? id,
          sublabel: s ? [s.status, s.origin_name || s.origin_address].filter(Boolean).join(' · ') : 'Delivery stop match',
          type: 'shipment',
          path: `/shipments?open=${id}`,
        });
      }
    }
  }

  return [...byId.values()].slice(0, RESULT_LIMIT);
}

async function searchCargoManifests(term: string): Promise<SearchResultItem[]> {
  const { data, error } = await supabase
    .from('cargo_manifest')
    .select('id, pickup_location, drop_location, status, created_at')
    .order('created_at', { ascending: false })
    .limit(CANDIDATE_LIMIT);
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  // Display tracking id, minted the same way as shipment.service.ts's
  // createManifest/listShipments: 'CM-' + the id's first 8 characters, uppercased.
  const displayId = (id: string) => manifestParcelCode(String(id));

  const cmMatch = CM_PREFIX_RE.exec(term.toUpperCase());
  const matches = cmMatch
    ? rows.filter(r => displayId(r.id).startsWith(`CM-${cmMatch[1]}`))
    : rows.filter(r => anyIncludes(term, r.pickup_location, r.drop_location));

  return matches.slice(0, RESULT_LIMIT).map(r => ({
    id: r.id,
    label: displayId(r.id),
    sublabel: [r.status, r.pickup_location, r.drop_location].filter(Boolean).join(' · '),
    type: 'cargo_manifest',
    path: `/shipments?open=${r.id}`,
  }));
}

async function searchVehicles(term: string): Promise<SearchResultItem[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, plate_number, driver_name, status, created_at')
    .order('created_at', { ascending: false })
    .limit(CANDIDATE_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter(v => anyIncludes(term, v.plate_number, v.driver_name))
    .slice(0, RESULT_LIMIT)
    .map(v => ({
      id: v.id,
      label: v.plate_number ?? v.id,
      sublabel: [v.driver_name, v.status].filter(Boolean).join(' · '),
      type: 'vehicle',
      path: `/fleet/${v.id}`,
    }));
}

async function searchVendors(term: string): Promise<SearchResultItem[]> {
  const { data, error } = await supabase
    .from('vendor_profiles')
    .select('id, company_name, gst_number, city, created_at')
    .order('created_at', { ascending: false })
    .limit(CANDIDATE_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter(v => anyIncludes(term, v.company_name, v.gst_number))
    .slice(0, RESULT_LIMIT)
    .map(v => ({
      id: v.id,
      label: v.company_name ?? v.id,
      sublabel: [v.gst_number, v.city].filter(Boolean).join(' · '),
      type: 'vendor',
      path: `/vendor-requests?open=${v.id}`,
    }));
}

async function searchPartners(term: string): Promise<SearchResultItem[]> {
  const { data, error } = await supabase
    .from('tpl_partners')
    .select('id, company_name, custom_id, status, created_at')
    .order('created_at', { ascending: false })
    .limit(CANDIDATE_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter(p => anyIncludes(term, p.company_name, p.custom_id))
    .slice(0, RESULT_LIMIT)
    .map(p => ({
      id: p.id,
      label: p.company_name ?? p.id,
      sublabel: [p.custom_id, p.status].filter(Boolean).join(' · '),
      type: 'partner',
      path: `/3pl-partners?open=${p.id}`,
    }));
}

async function searchUsers(term: string, includeContact: boolean): Promise<SearchResultItem[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, phone, role, created_at')
    .order('created_at', { ascending: false })
    .limit(CANDIDATE_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter(u => anyIncludes(term, u.full_name) || (includeContact && anyIncludes(term, u.email, u.phone)))
    .slice(0, RESULT_LIMIT)
    .map(u => ({
      id: u.id,
      label: u.full_name ?? u.id,
      sublabel: [u.role, includeContact ? u.email : undefined].filter(Boolean).join(' · '),
      type: 'user',
      path: `/admin/users?open=${u.id}`,
    }));
}

export const searchService = {
  /** Runs every table search in parallel. `isSuperadmin` gates email/phone search on users. */
  async search(rawQuery: string, isSuperadmin: boolean): Promise<SearchResults> {
    const term = rawQuery.trim().toLowerCase();
    const [shipments, cargo_manifests, vehicles, vendors, partners, users] = await Promise.all([
      searchShipments(term),
      searchCargoManifests(term),
      searchVehicles(term),
      searchVendors(term),
      searchPartners(term),
      searchUsers(term, isSuperadmin),
    ]);
    return { shipments, cargo_manifests, vehicles, vendors, partners, users };
  },
};
