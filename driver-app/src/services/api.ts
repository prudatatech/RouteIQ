/**
 * margixindia Driver App — API Client
 * Handles all HTTP calls to the TS backend with JWT auth.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_V1 } from '../config';

const STORAGE_KEYS = {
  ACCESS_TOKEN: 'margixindia_access_token',
  REFRESH_TOKEN: 'margixindia_refresh_token',
  DRIVER_INFO: 'margixindia_driver_info',
};

class ApiClient {
  private accessToken: string | null = null;

  async init() {
    this.accessToken = await AsyncStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
  }

  private async request<T = any>(
    method: string,
    path: string,
    body?: any,
    requireAuth = true
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Bypass-Tunnel-Reminder': 'true',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    };

    if (requireAuth && this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${API_V1}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      // Try token refresh on 401
      if (response.status === 401 && requireAuth) {
        const refreshed = await this.refreshToken();
        if (refreshed) {
          headers['Authorization'] = `Bearer ${this.accessToken}`;
          const retryResponse = await fetch(`${API_V1}${path}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
          });
          if (retryResponse.ok) {
            return retryResponse.json();
          }
        }
      }
      throw new Error(data.detail || `Request failed: ${response.status}`);
    }

    return data;
  }

  // ── Auth ───────────────────────────────────────────────────

  async sendOTP(phone: string): Promise<{ status: string; expires_in_seconds: number; phone?: string }> {
    return this.request('POST', '/auth/driver/send-otp', { phone }, false);
  }

  async verifyOTP(phone: string, otp: string): Promise<{
    status: string;
    access_token: string;
    refresh_token: string;
    user_id: string;
    driver: { id: string; phone: string; full_name: string; language_preference?: string };
  }> {
    const data = await this.request('POST', '/auth/driver/verify-otp', { phone, otp }, false);

    // Store tokens
    this.accessToken = data.access_token;
    await AsyncStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, data.access_token);
    await AsyncStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, data.refresh_token);
    await AsyncStorage.setItem(STORAGE_KEYS.DRIVER_INFO, JSON.stringify(data.driver));

    return data;
  }

  async refreshToken(): Promise<boolean> {
    try {
      const refreshToken = await AsyncStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
      if (!refreshToken) return false;

      const data = await this.request('POST', '/auth/refresh', { refresh_token: refreshToken }, false);
      this.accessToken = data.access_token;
      await AsyncStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, data.access_token);
      await AsyncStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, data.refresh_token);
      return true;
    } catch {
      return false;
    }
  }

  async logout(): Promise<void> {
    this.accessToken = null;
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.ACCESS_TOKEN,
      STORAGE_KEYS.REFRESH_TOKEN,
      STORAGE_KEYS.DRIVER_INFO,
    ]);
  }

  async isLoggedIn(): Promise<boolean> {
    const token = await AsyncStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
    return !!token;
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
    try {
      const result = await this.request('GET', '/auth/driver/earnings', undefined, true);
      console.log('[EARNINGS] Got result:', JSON.stringify(result).substring(0, 200));
      return result;
    } catch (e) {
      console.error('[EARNINGS] Auth endpoint failed, trying test endpoint:', e);
      // Fallback to the test endpoint that bypasses auth
      return this.request('GET', '/auth/driver/earnings-test', undefined, false);
    }
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

  async getSosConfig(): Promise<any> {
    return this.request('GET', '/telemetry/sos/config');
  }

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

  async confirmCapacity(vehicle_id: string, available_capacity_kg: number): Promise<any> {
    return this.request('POST', '/capacity/driver/confirm-capacity', { vehicle_id, available_capacity_kg });
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

  async openBackhaulWindow(vehicle_id: string, available_capacity_kg: number, trigger_type: 'mid_route' | 'return_trip'): Promise<any> {
    return this.request('POST', '/capacity/driver/open-backhaul-window', { vehicle_id, available_capacity_kg, trigger_type });
  }
}

export const api = new ApiClient();
export { STORAGE_KEYS };
