/**
 * margixindia — Traffic incidents inside a map viewport
 *
 * Feeds the incidents layer of the maps. Stored incidents (traffic_incidents, kept fresh by the
 * route monitor in traffic.service) come first. When the viewport is small enough for TomTom and
 * nothing in it was fetched during the last 5 minutes, TomTom is asked for the viewport and the
 * result is stored, so the layer also shows incidents away from the active routes.
 */
import { supabase } from '../core/supabase';
import { cacheGet, cacheSet } from '../core/redis';
import { HttpError } from '../core/errors';
import { fetchTile, isTrafficConfigured, TrafficIncident } from './traffic.service';

export type Bbox = [minLng: number, minLat: number, maxLng: number, maxLat: number];

/** A viewport is re-fetched from TomTom when its last fetch is older than this. */
export const AREA_FRESH_SECONDS = 5 * 60;
/** TomTom answers one request for at most 10,000 km². */
export const MAX_REFRESH_AREA_KM2 = 10_000;
/** Viewports are snapped outwards to this grid so nearby viewports share one TomTom call and one freshness mark. */
const SNAP_DEG = 0.25;
const MAX_ROWS = 600;

export type IncidentKind = 'accident' | 'roadworks' | 'closure' | 'jam' | 'flooding' | 'weather' | 'hazard' | 'breakdown' | 'other';

const KIND_BY_TYPE: Record<string, IncidentKind> = {
  'Accident': 'accident',
  'Road works': 'roadworks',
  'Road closed': 'closure',
  'Lane closed': 'closure',
  'Traffic jam': 'jam',
  'Flooding': 'flooding',
  'Fog': 'weather', 'Heavy rain': 'weather', 'Strong wind': 'weather', 'Ice on the road': 'weather',
  'Dangerous conditions': 'hazard',
  'Broken-down vehicle': 'breakdown',
};

/** Icon family of an incident, from the plain-language type stored with it. */
export function incidentKind(type: string | null | undefined): IncidentKind {
  return (type && KIND_BY_TYPE[type]) || 'other';
}

/** Parses "minLng,minLat,maxLng,maxLat"; throws a 400 for anything that is not a real box on Earth. */
export function parseBbox(raw: unknown): Bbox {
  const parts = typeof raw === 'string' ? raw.split(',') : [];
  const nums = parts.map(p => (p.trim() === '' ? NaN : Number(p)));
  if (nums.length !== 4 || nums.some(n => !Number.isFinite(n))) throw new HttpError(400, 'bbox must be minLng,minLat,maxLng,maxLat');
  const [minLng, minLat, maxLng, maxLat] = nums;
  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90) throw new HttpError(400, 'bbox is outside the world');
  if (minLng >= maxLng || minLat >= maxLat) throw new HttpError(400, 'bbox must have min below max');
  return [minLng, minLat, maxLng, maxLat];
}

export function bboxAreaKm2([minLng, minLat, maxLng, maxLat]: Bbox): number {
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  return (maxLat - minLat) * 110.574 * (maxLng - minLng) * 111.32 * Math.cos(midLat);
}

export function snapBbox([minLng, minLat, maxLng, maxLat]: Bbox): Bbox {
  const down = (n: number) => Math.floor(n / SNAP_DEG) * SNAP_DEG;
  const up = (n: number) => Math.ceil(n / SNAP_DEG) * SNAP_DEG;
  return [Math.max(-180, down(minLng)), Math.max(-90, down(minLat)), Math.min(180, up(maxLng)), Math.min(90, up(maxLat))];
}

const boxKey = (b: Bbox) => b.map(n => n.toFixed(2)).join(',');

export type RefreshOutcome = 'fetched' | 'fresh' | 'not_requested' | 'not_configured' | 'area_too_large' | 'failed';

export interface AreaIncident {
  id: string; type: string; kind: IncidentKind; severity: number; description: string | null; road: string | null;
  lat: number; lng: number; delay_seconds: number | null; starts_at: string | null; ends_at: string | null; last_seen_at: string | null;
}

/** Fetches the (snapped) box from TomTom and stores what it reports; incidents it no longer reports there are closed. */
async function refreshArea(box: Bbox): Promise<'fetched' | 'failed'> {
  const startedAt = new Date().toISOString();
  let incidents: TrafficIncident[];
  try {
    incidents = await fetchTile(box);
  } catch (e) {
    console.warn('[traffic] TomTom area request failed:', (e as Error).message);
    return 'failed';
  }
  for (const inc of incidents) {
    // affected_route_ids is left alone: the route monitor owns it
    const { error } = await supabase.from('traffic_incidents').upsert({
      id: inc.id, type: inc.type, severity: inc.severity, description: inc.description, road: inc.road,
      lat: inc.lat, lng: inc.lng, geometry: inc.geometry, delay_seconds: inc.delay_seconds,
      starts_at: inc.starts_at, ends_at: inc.ends_at, active: true, last_seen_at: new Date().toISOString(),
    });
    if (error) console.error('[traffic] Could not store incident:', error.message);
  }
  const [minLng, minLat, maxLng, maxLat] = box;
  const { error } = await supabase.from('traffic_incidents').update({ active: false })
    .eq('active', true).lt('last_seen_at', startedAt)
    .gte('lat', minLat).lte('lat', maxLat).gte('lng', minLng).lte('lng', maxLng);
  if (error) console.error('[traffic] Could not close cleared incidents:', error.message);
  return 'fetched';
}

export async function incidentsInBbox(bbox: Bbox, wantRefresh: boolean): Promise<{
  configured: boolean; incidents: AreaIncident[]; refresh: RefreshOutcome; fetched_at: string | null;
}> {
  let refresh: RefreshOutcome = 'not_requested';
  let fetchedAt: string | null = null;
  const box = snapBbox(bbox);
  const key = `traffic:area:${boxKey(box)}`;

  if (wantRefresh) {
    if (!isTrafficConfigured()) refresh = 'not_configured';
    else if (bboxAreaKm2(box) > MAX_REFRESH_AREA_KM2) refresh = 'area_too_large';
    else {
      const mark = await cacheGet<string>(key);
      if (mark) { refresh = 'fresh'; fetchedAt = mark; }
      else {
        refresh = await refreshArea(box);
        if (refresh === 'fetched') {
          fetchedAt = new Date().toISOString();
          await cacheSet(key, fetchedAt, AREA_FRESH_SECONDS);
        }
      }
    }
  }

  const [minLng, minLat, maxLng, maxLat] = bbox;
  const { data, error } = await supabase
    .from('traffic_incidents')
    .select('id, type, severity, description, road, lat, lng, delay_seconds, starts_at, ends_at, last_seen_at')
    .eq('active', true)
    .gte('lat', minLat).lte('lat', maxLat).gte('lng', minLng).lte('lng', maxLng)
    .order('severity', { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw error;
  const incidents = (data ?? []).map((r: any): AreaIncident => ({ ...r, kind: incidentKind(r.type) }));
  return { configured: isTrafficConfigured(), incidents, refresh, fetched_at: fetchedAt };
}
