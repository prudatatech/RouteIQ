import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_V1 } from '../config';
import { secureStorage } from './secureStorage';

// Access/refresh tokens live in SecureStore (see secureStorage.ts). Non-sensitive
// profile data (customer name/phone) stays in AsyncStorage. STORAGE_KEYS also
// doubles as the set of legacy AsyncStorage keys migrated out on first init()
// after this change, so existing logged-in users are not logged out.
const STORAGE_KEYS = {
  ACCESS_TOKEN: 'margixindia_customer_access_token',
  REFRESH_TOKEN: 'margixindia_customer_refresh_token',
  CUSTOMER_INFO: 'margixindia_customer_info',
};

class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  async init() {
    await this.migrateLegacyTokens();
    this.accessToken = await secureStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
    this.refreshToken = await secureStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
  }

  /** Runs init() and reports whether a stored session was found. */
  async hasSession(): Promise<boolean> {
    await this.init();
    return !!this.accessToken;
  }

  /** One-time migration: legacy tokens were stored in plain AsyncStorage. */
  private async migrateLegacyTokens() {
    const [legacyAccess, legacyRefresh] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN),
      AsyncStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN),
    ]);

    if (!legacyAccess && !legacyRefresh) return;

    if (legacyAccess) await secureStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, legacyAccess);
    if (legacyRefresh) await secureStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, legacyRefresh);

    await AsyncStorage.multiRemove([STORAGE_KEYS.ACCESS_TOKEN, STORAGE_KEYS.REFRESH_TOKEN]);
  }

  private async setTokens(accessToken: string, refreshToken: string) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    await secureStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
    await secureStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
  }

  private async clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    await secureStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
    await secureStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
    await AsyncStorage.removeItem(STORAGE_KEYS.CUSTOMER_INFO);
  }

  /** Refreshes the access token using the stored refresh token. Coalesces concurrent callers. */
  private async refreshAccessToken(): Promise<boolean> {
    if (!this.refreshToken) return false;

    if (!this.refreshPromise) {
      this.refreshPromise = (async () => {
        try {
          const response = await fetch(`${API_V1}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: this.refreshToken }),
          });

          if (!response.ok) return false;

          const data = await response.json();
          if (!data.access_token || !data.refresh_token) return false;

          await this.setTokens(data.access_token, data.refresh_token);
          return true;
        } catch {
          return false;
        } finally {
          this.refreshPromise = null;
        }
      })();
    }

    return this.refreshPromise;
  }

  private async request<T = any>(
    method: string,
    path: string,
    body?: any,
    requireAuth = true,
    isRetry = false
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (requireAuth && this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${API_V1}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 401 && requireAuth && !isRetry) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        return this.request<T>(method, path, body, requireAuth, true);
      }
      await this.clearTokens();
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || `Request failed: ${response.status}`);
    }

    return data;
  }

  // ── Auth ───────────────────────────────────────────────────

  async sendOTP(phone: string): Promise<{ status: string; expires_in_seconds: number; phone?: string }> {
    return this.request('POST', '/auth/customer/send-otp', { phone }, false);
  }

  async verifyOTP(phone: string, otp: string): Promise<{
    status: string;
    access_token: string;
    refresh_token: string;
    user_id: string;
    customer: any;
  }> {
    const data = await this.request('POST', '/auth/customer/verify-otp', { phone, otp }, false);

    await this.setTokens(data.access_token, data.refresh_token);
    await AsyncStorage.setItem(STORAGE_KEYS.CUSTOMER_INFO, JSON.stringify(data.customer));

    return data;
  }

  async logout(): Promise<void> {
    await this.clearTokens();
  }

  // ── Notifications ──────────────────────────────────────────

  async getNotifications(params: { limit?: number; offset?: number } = {}): Promise<{
    notifications: NotificationItem[];
    total: number;
    unread_count: number;
    limit: number;
    offset: number;
  }> {
    const query = new URLSearchParams();
    if (params.limit != null) query.set('limit', String(params.limit));
    if (params.offset != null) query.set('offset', String(params.offset));
    const qs = query.toString();
    return this.request('GET', `/notifications${qs ? `?${qs}` : ''}`);
  }

  async markNotificationRead(id: string): Promise<NotificationItem> {
    return this.request('POST', `/notifications/${id}/read`);
  }

  async markAllNotificationsRead(): Promise<{ success: boolean }> {
    return this.request('POST', '/notifications/read-all');
  }

  // ── Quote ──────────────────────────────────────────────────

  /**
   * Price for a shipment. The pricing engine's contract is
   * {low, suggested, high, factors[]}; today the backend answers from the
   * per-km rate, and this function is the only place that needs to change
   * if the endpoint moves to /pricing/quote.
   */
  async getQuote(input: QuoteRequest): Promise<Quote> {
    return this.request('POST', '/customer/quote', input);
  }

  // ── Bookings ───────────────────────────────────────────────

  /** The price is worked out again on the server; the app never sends one. */
  async createBooking(input: BookingRequest): Promise<Booking> {
    return this.request('POST', '/customer/bookings', input);
  }

  async listBookings(): Promise<Booking[]> {
    return this.request('GET', '/customer/bookings');
  }

  async getBooking(id: string): Promise<BookingDetail> {
    return this.request('GET', `/customer/bookings/${id}`);
  }

  async cancelBooking(id: string, reason?: string): Promise<Booking> {
    return this.request('POST', `/customer/bookings/${id}/cancel`, reason ? { reason } : {});
  }
}

export interface QuoteRequest {
  pickup_lat: number;
  pickup_lng: number;
  drop_lat: number;
  drop_lng: number;
  weight_kg: number;
  vehicle_type?: string | null;
  load_type: 'full' | 'part';
  /** Pickup day, YYYY-MM-DD (India). */
  date: string;
}

export interface BookingRequest extends QuoteRequest {
  pickup_name: string;
  pickup_address: string;
  drop_name: string;
  drop_address: string;
}

export type BookingStatus = 'requested' | 'confirmed' | 'assigned' | 'in_transit' | 'delivered' | 'cancelled';

export interface Booking {
  id: string;
  pickup_name: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  drop_name: string;
  drop_address: string;
  drop_lat: number;
  drop_lng: number;
  weight_kg: number;
  load_type: 'full' | 'part';
  vehicle_type: string | null;
  /** YYYY-MM-DD */
  pickup_date: string;
  quoted_price: number | null;
  status: BookingStatus;
  tracking_id: string | null;
  cancel_reason: string | null;
  created_at: string;
}

/** What the public tracking endpoint returns for a shipment (no vendor or driver details). */
export interface Tracking {
  status: string;
  eta_minutes: number | null;
  vehicle: { plate_number: string | null; type: string | null; lat: number | null; lng: number | null } | null;
  destination: { name: string | null; address: string | null; lat: number | null; lng: number | null } | null;
  origin_lat: number | null;
  origin_lng: number | null;
  history: { status: string; at: string }[];
}

export interface BookingDetail {
  booking: Booking;
  tracking: Tracking | null;
}

export interface Quote {
  /** False when no price can be given yet. */
  available: boolean;
  low: number | null;
  suggested: number | null;
  high: number | null;
  distance_km: number | null;
  factors: { label: string; detail: string }[];
  message?: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  type: string;
  is_read: boolean;
  data: Record<string, any> | null;
  created_at: string;
}

export const api = new ApiClient();
export { STORAGE_KEYS };
