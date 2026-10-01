/**
 * margixindia — A vehicle's current position, and the live-location links staff share.
 *
 * getVehicleLocation: latest position with speed, heading and accuracy from the
 * newest telemetry / GPS history rows. The share link is a random token (only its
 * SHA-256 is stored) that expires; the public page it opens is read-only and shows
 * the position and a short trail, nothing about the load, the driver or customers.
 */
import crypto from 'crypto';
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { isLive, lastSeenMs } from '../core/vehicles';
import { getAlertThresholds } from './alert-settings.service';
import { loadTrack } from './gps-history.service';
import { getVehicleActivity, type ActivityState } from './vehicle-activity.service';

export interface VehicleLocation {
  vehicle_id: string;
  plate_number: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  /** Name stored on the vehicle for where it is, when there is one. */
  place_name: string | null;
  speed_kmph: number | null;
  heading: number | null;
  /** GPS accuracy in metres, when the device reports it. */
  accuracy_m: number | null;
  /** When the position was taken. */
  recorded_at: string | null;
  last_seen_at: string | null;
  live: boolean;
  gps_device: string | null;
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const newest = <T extends Record<string, any>>(rows: T[] | null, key: string): T | null =>
  (rows ?? []).slice().sort((a, b) => Date.parse(b[key]) - Date.parse(a[key]))[0] ?? null;

export async function getVehicleLocation(vehicleId: string, now: number = Date.now()): Promise<VehicleLocation> {
  // The vehicle, the limits and the newest readings are independent: one round trip
  const [vehicleRes, limits, telemetryRes, pointRes] = await Promise.all([
    supabase
      .from('vehicles')
      .select('id, plate_number, status, latitude, longitude, last_heartbeat, last_sync, current_location_name, spark_id')
      .eq('id', vehicleId)
      .maybeSingle(),
    getAlertThresholds(),
    supabase.from('telemetry').select('speed_kmph, heading, timestamp').eq('vehicle_id', vehicleId).order('timestamp', { ascending: false }).limit(1),
    supabase.from('gps_points').select('accuracy, recorded_at').eq('vehicle_id', vehicleId).order('recorded_at', { ascending: false }).limit(1),
  ]);
  const { data: vehicle, error } = vehicleRes;
  if (error) throw error;
  if (!vehicle) throw new HttpError(404, 'Vehicle not found');
  if (telemetryRes.error) throw telemetryRes.error;
  if (pointRes.error) throw pointRes.error;

  const live = isLive(vehicle, limits.gps_lost_minutes, now);
  const seen = lastSeenMs(vehicle);
  const telemetry = newest(telemetryRes.data, 'timestamp');
  const point = newest(pointRes.data, 'recorded_at');
  // Speed and heading describe the vehicle only while it is reporting
  const fresh = telemetry && now - Date.parse(telemetry.timestamp) <= limits.gps_lost_minutes * 60_000;

  return {
    vehicle_id: vehicle.id,
    plate_number: vehicle.plate_number,
    status: String(vehicle.status),
    latitude: num(vehicle.latitude),
    longitude: num(vehicle.longitude),
    place_name: vehicle.current_location_name ?? null,
    speed_kmph: fresh ? num(telemetry!.speed_kmph) : null,
    heading: fresh ? num(telemetry!.heading) : null,
    accuracy_m: point ? num(point.accuracy) : null,
    recorded_at: seen != null ? new Date(seen).toISOString() : null,
    last_seen_at: seen != null ? new Date(seen).toISOString() : null,
    live,
    gps_device: vehicle.spark_id ?? null,
  };
}

// ── Share links ──────────────────────────────────────────────

export const SHARE_DEFAULT_HOURS = 24;
export const SHARE_MAX_HOURS = 24 * 7;
/** The public page shows the last few hours of the path. */
const SHARE_TRAIL_HOURS = 3;
const SHARE_TRAIL_POINTS = 200;

export const hashShareToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

export interface ShareLink {
  id: string;
  vehicle_id: string;
  expires_at: string;
  created_at: string;
  view_count: number;
  last_viewed_at: string | null;
}

/** Create a link that shows the vehicle's live position until it expires. The token is returned once. */
export async function createShareLink(vehicleId: string, createdBy: string | null, hours: number = SHARE_DEFAULT_HOURS): Promise<ShareLink & { token: string }> {
  const { data: vehicle, error: vErr } = await supabase.from('vehicles').select('id').eq('id', vehicleId).maybeSingle();
  if (vErr) throw vErr;
  if (!vehicle) throw new HttpError(404, 'Vehicle not found');
  const token = crypto.randomBytes(24).toString('base64url');
  const { data, error } = await supabase
    .from('vehicle_share_links')
    .insert({
      vehicle_id: vehicleId,
      token_hash: hashShareToken(token),
      created_by: createdBy,
      expires_at: new Date(Date.now() + hours * 3_600_000).toISOString(),
    })
    .select('id, vehicle_id, expires_at, created_at, view_count, last_viewed_at')
    .single();
  if (error) throw error;
  return { ...(data as ShareLink), token };
}

/** Links for a vehicle that are still open (not revoked, not expired), newest first. */
export async function listShareLinks(vehicleId: string, now: number = Date.now()): Promise<ShareLink[]> {
  const { data, error } = await supabase
    .from('vehicle_share_links')
    .select('id, vehicle_id, expires_at, created_at, view_count, last_viewed_at, revoked_at')
    .eq('vehicle_id', vehicleId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as (ShareLink & { revoked_at: string | null })[])
    .filter(l => !l.revoked_at && Date.parse(l.expires_at) > now)
    .map(({ revoked_at: _revoked, ...link }) => link);
}

/** Stop a link from working. Returns false when there was no open link with that id. */
export async function revokeShareLink(linkId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('vehicle_share_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', linkId)
    .is('revoked_at', null)
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

export interface PublicShare {
  plate_number: string;
  expires_at: string;
  live: boolean;
  state: ActivityState;
  latitude: number | null;
  longitude: number | null;
  speed_kmph: number | null;
  heading: number | null;
  last_seen_at: string | null;
  trail: { lat: number; lng: number; at: string }[];
}

/** Every Nth item so at most `max` are kept, always keeping the first and the last. */
export function thin<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = (items.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => items[Math.round(i * step)]);
}

/** What the public page shows for a token, or null when it is unknown, revoked or expired. */
export async function getPublicShare(token: string, now: number = Date.now()): Promise<PublicShare | null> {
  const { data: link, error } = await supabase
    .from('vehicle_share_links')
    .select('id, vehicle_id, expires_at, revoked_at, view_count')
    .eq('token_hash', hashShareToken(token))
    .maybeSingle();
  if (error) throw error;
  if (!link || link.revoked_at || Date.parse(link.expires_at) <= now) return null;

  const [location, activity, track] = await Promise.all([
    getVehicleLocation(link.vehicle_id, now),
    getVehicleActivity(link.vehicle_id, now),
    loadTrack(link.vehicle_id, new Date(now - SHARE_TRAIL_HOURS * 3_600_000), new Date(now), 1000),
  ]);
  await supabase
    .from('vehicle_share_links')
    .update({ view_count: (Number(link.view_count) || 0) + 1, last_viewed_at: new Date(now).toISOString() })
    .eq('id', link.id);

  return {
    plate_number: location.plate_number,
    expires_at: link.expires_at,
    live: location.live,
    state: activity.state,
    latitude: location.latitude,
    longitude: location.longitude,
    speed_kmph: location.speed_kmph,
    heading: location.heading,
    last_seen_at: location.last_seen_at,
    trail: thin(track.points.map(p => ({ lat: p.lat, lng: p.lng, at: p.at })), SHARE_TRAIL_POINTS),
  };
}
