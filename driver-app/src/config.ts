/**
 * margixindia Driver App — API Configuration
 */

// Change this to your backend URL
// Local dev: Your computer's local IP (e.g. 192.168.29.34)
// Railway: https://routeiq-production-7fb8.up.railway.app
export const API_BASE_URL = __DEV__
  ? 'http://192.168.1.103:8000' // Local IP for fast direct connection
  : 'https://routeiq-production-7fb8.up.railway.app';

export const API_V1 = `${API_BASE_URL}/api/v1`;

// Google Maps API Key (for MapView)
export const GOOGLE_MAPS_API_KEY = 'AIzaSyB7XAze_uFE14yzA9sKuMaHShvqDtEA_Tw';

// GPS Ping defaults (server overrides these)
export const DEFAULT_PING_INTERVAL_MS = 5000; // 5 seconds (Zomato-style high-frequency)
export const MIN_PING_INTERVAL_MS = 5000;
export const MAX_PING_INTERVAL_MS = 60000;
