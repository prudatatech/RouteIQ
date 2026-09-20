
export const API_BASE_URL = 'https://routeiq-production-7034.up.railway.app';

export const API_V1 = `${API_BASE_URL}/api/v1`;

// Google Maps API Key (for MapView)
export const GOOGLE_MAPS_API_KEY = 'AIzaSyB7XAze_uFE14yzA9sKuMaHShvqDtEA_Tw';

// GPS Ping defaults (server overrides these)
export const DEFAULT_PING_INTERVAL_MS = 5000; // 5 seconds (Zomato-style high-frequency)
export const MIN_PING_INTERVAL_MS = 5000;
export const MAX_PING_INTERVAL_MS = 60000;
