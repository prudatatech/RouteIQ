/**
 * margixindia Driver App — API Client
 * Handles all HTTP calls to the TS backend, authenticated with the driver's
 * Supabase access token (the backend verifies it via JWKS).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_V1 } from '../config';
import { supabase } from './supabase';

const STORAGE_KEYS = {
  DRIVER_INFO: 'margixindia_driver_info',
};

// Tokens stored in AsyncStorage by builds before the Supabase-session release.
const LEGACY_TOKEN_KEYS = ['margixindia_access_token', 'margixindia_refresh_token'];

export class SessionExpiredError extends Error {
  constructor() {
    super('Your session has expired. Please log in again.');
    this.name = 'SessionExpiredError';
  }
}

async function currentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function parseBody(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

class ApiClient {
  /** Drop tokens left behind by older builds; they are no longer used. */
  async init() {
    await AsyncStorage.multiRemove(LEGACY_TOKEN_KEYS).catch(() => {});
  }

  private send(method: string, path: string, body: any, token: string | null) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Bypass-Tunnel-Reminder': 'true',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return fetch(`${API_V1}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  private async request<T = any>(
    method: string,
    path: string,
    body?: any,
    requireAuth = true
  ): Promise<T> {
    let response = await this.send(method, path, body, requireAuth ? await currentAccessToken() : null);

    if (response.status === 401 && requireAuth) {
      // Refresh the Supabase session once and retry; if that fails the driver must log in again.
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) {
        await this.endSession();
        throw new SessionExpiredError();
      }
      response = await this.send(method, path, body, data.session.access_token);
      if (response.status === 401) {
        await this.endSession();
        throw new SessionExpiredError();
      }
    }

    const data = await parseBody(response);
    if (!response.ok) {
      throw new Error(data.detail || data.error || `Request failed: ${response.status}`);
    }
    return data;
  }

  /** Clear the local session after an auth failure (App listens for SIGNED_OUT). */
  private async endSession() {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    await AsyncStorage.removeItem(STORAGE_KEYS.DRIVER_INFO).catch(() => {});
  }

  // ── Auth ───────────────────────────────────────────────────

  async sendOTP(phone: string): Promise<{ status: string; expires_in_seconds: number; phone?: string }> {
    return this.request('POST', '/auth/driver/send-otp', { phone }, false);
  }

  async verifyOTP(phone: string, otp: string): Promise<{
    status: string;
    user_id: string;
    supabase_session: { access_token: string; refresh_token: string; expires_at?: number } | null;
    driver: { id: string; phone: string; full_name: string; language_preference?: string };
  }> {
    const data = await this.request('POST', '/auth/driver/verify-otp', { phone, otp }, false);

    const issued = data.supabase_session;
    if (!issued?.access_token || !issued?.refresh_token) {
      throw new Error('Login could not be completed because the server did not start a session. Please try again.');
    }

    const { data: sessionData, error } = await supabase.auth.setSession({
      access_token: issued.access_token,
      refresh_token: issued.refresh_token,
    });
    if (error || !sessionData.session) {
      throw new Error('Login could not be completed. Please try again.');
    }
    if (data.driver?.id && sessionData.session.user.id !== data.driver.id) {
      await this.endSession();
      throw new Error('Login could not be completed (account mismatch). Please contact your fleet manager.');
    }

    // Non-sensitive profile only; credentials live in the secure store via Supabase Auth.
    await AsyncStorage.setItem(STORAGE_KEYS.DRIVER_INFO, JSON.stringify(data.driver));

    return data;
  }

  async logout(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) {
      // Server-side sign-out failed (e.g. offline); still clear the local session.
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    }
    await AsyncStorage.removeItem(STORAGE_KEYS.DRIVER_INFO);
  }

  async isLoggedIn(): Promise<boolean> {
    return !!(await currentAccessToken());
  }

  async getDriverInfo(): Promise<any> {
    const info = await AsyncStorage.getItem(STORAGE_KEYS.DRIVER_INFO);
    return info ? JSON.parse(info) : null;
  }

  async updateLanguagePreference(language: string): Promise<void> {
    await this.request('PUT', '/users/language', { language }, true);
  }

  async updateProfile(data: { vehicle_type?: string; full_name?: string }): Promise<any> {
    const res = await this.request('PUT', '/auth/driver/profile', data, true);
    // Update local driver info
    const infoStr = await AsyncStorage.getItem(STORAGE_KEYS.DRIVER_INFO);
    if (infoStr) {
      const info = JSON.parse(infoStr);
      if (data.vehicle_type) info.vehicle_type = data.vehicle_type;
      if (data.full_name) info.full_name = data.full_name;
      await AsyncStorage.setItem(STORAGE_KEYS.DRIVER_INFO, JSON.stringify(info));
    }
    return res;
  }

  async getDriverEarnings(): Promise<any> {
    return this.request('GET', '/auth/driver/earnings', undefined, true);
  }

  // ── Driver GPS Ping ────────────────────────────────────────

  async sendPing(pings: Array<{
    lat: number;
    lng: number;
    speed: number;
    heading: number;
    accuracy: number;
    timestamp: string;
  }>): Promise<{
    status: string;
    pings_processed: number;
    next_ping_interval_ms: number;
    geofence_alert: any;
    pending_commands: any[];
  }> {
    return this.request('POST', '/telemetry/driver-ping', { pings });
  }

  // ── Route ──────────────────────────────────────────────────

  async triggerSos(lat: number, lng: number): Promise<any> {
    return this.request('POST', '/telemetry/sos/trigger', { lat, lng });
  }

  async getMyRoute(): Promise<any> {
    return this.request('GET', `/telemetry/driver-ping/my-route?t=${Date.now()}`);
  }

  async setBreakStatus(is_break: boolean): Promise<any> {
    return this.request('POST', '/telemetry/driver-ping/break', { is_break });
  }

  async startRoute(route_id: string): Promise<any> {
    return this.request('POST', '/telemetry/driver-ping/start-route', { route_id });
  }

  async updateRouteStatus(route_id: string, status: string): Promise<any> {
    return this.request('PATCH', `/routes/${route_id}/status`, { status });
  }

  async completeStop(data: {
    stop_id: string;
    status?: 'completed' | 'failed';
    lat?: number;
    lng?: number;
    /** Name of the person who received the goods (proof of delivery). */
    received_by?: string;
    photo_url?: string;
    signature_data?: string;
  }): Promise<any> {
    return this.request('POST', '/telemetry/driver-ping/complete-stop', data);
  }

  async reportSOS(vehicle_id: string, alert_type: string, description: string, latitude: number, longitude: number): Promise<any> {
    return this.request('POST', `/vehicles/${vehicle_id}/sos`, { alert_type, description, latitude, longitude });
  }

  // ── Capacity Bidding / Safety Valve ──────────────────────────────────
  async declareCapacity(vehicle_id: string, declared_load_percentage: number): Promise<any> {
    return this.request('PATCH', `/vehicles/${vehicle_id}`, { declared_load_percentage });
  }

  async getVehicleInfo(vehicle_id: string): Promise<any> {
    return this.request('GET', `/vehicles/${vehicle_id}`);
  }

  async toggleBiddingWindow(vehicle_id: string, enabled: boolean): Promise<any> {
    return this.request('POST', '/capacity/driver/toggle-matching', { vehicle_id, enabled });
  }

  async ackStop(confirmation_id: string): Promise<any> {
    return this.request('POST', '/capacity/driver/ack-stop', { confirmation_id });
  }

  async flagStop(confirmation_id: string): Promise<any> {
    return this.request('POST', '/capacity/driver/flag-stop', { confirmation_id });
  }

  async getWindowBidCount(window_id: string): Promise<{ count: number }> {
    return this.request('GET', `/capacity/windows/${encodeURIComponent(window_id)}/bid-count`);
  }

  async openBackhaulWindow(vehicle_id: string, available_capacity_kg: number, trigger_type: 'mid_route' | 'return_trip'): Promise<any> {
    return this.request('POST', '/capacity/driver/open-backhaul-window', { vehicle_id, available_capacity_kg, trigger_type });
  }
}

export const api = new ApiClient();
export { STORAGE_KEYS };
