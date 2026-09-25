import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Use the production backend URL (matches Driver App)
const API_BASE_URL = 'https://routeiq-production-7034.up.railway.app';
const API_V1 = `${API_BASE_URL}/api/v1`;

const STORAGE_KEYS = {
  ACCESS_TOKEN: 'margixindia_customer_access_token',
  REFRESH_TOKEN: 'margixindia_customer_refresh_token',
  CUSTOMER_INFO: 'margixindia_customer_info',
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

    // Store tokens
    this.accessToken = data.access_token;
    await AsyncStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, data.access_token);
    await AsyncStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, data.refresh_token);
    await AsyncStorage.setItem(STORAGE_KEYS.CUSTOMER_INFO, JSON.stringify(data.customer));

    return data;
  }
  
  async logout(): Promise<void> {
    this.accessToken = null;
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.ACCESS_TOKEN,
      STORAGE_KEYS.REFRESH_TOKEN,
      STORAGE_KEYS.CUSTOMER_INFO,
    ]);
  }
}

export const api = new ApiClient();
export { STORAGE_KEYS };
