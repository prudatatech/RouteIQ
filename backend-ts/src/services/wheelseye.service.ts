import axios from 'axios';
import { settings } from '../core/config';
import { supabase } from '../core/supabase';

export interface WheelseyePlaceSuggestion {
  addressId: string | null;
  placeId: string;
  addressLineOne: string;
  addressLineTwo: string;
  addressLineThree: string | null;
  source: 'GOOGLE' | 'RECENT';
  loc: { lat: number; lng: number } | null;
  pincode: string | null;
}

export interface WheelseyeLocItem {
  placeId: string;
  address: string;
  name: string;
  source: 'GOOGLE' | 'RECENT';
  addressSummary: string;
  loc: { lat: number; lng: number };
  buildingName: string;
  addressLineOne: string;
  pincode: string;
  type: 'LOADING' | 'CONSIGNEE';
  title?: {
    buildingName: string;
    addressLineOne: string;
  };
}

export interface WheelseyePricePayload {
  locs: WheelseyeLocItem[];
  tonnage: number;
  bodyType: string;
}

export interface WheelseyeConfig {
  enabled: boolean;
  token: string;
  user_code: string;
  session_id: string;
  device_id: string;
  pricing_url: string;
  user_agent: string;
  updated_at?: string;
  updated_by?: string;
  last_tested_at?: string;
  last_test_status?: 'ok' | 'rate_limited' | 'unauthorized' | 'error';
  last_test_message?: string;
  last_test_latency_ms?: number;
  last_test_result?: {
    vehicles_count?: number;
    sample_rates?: Array<{ name: string; price: number; bodyType: string }>;
  };
}

export interface WheelseyeTestResult {
  success: boolean;
  status: number;
  latencyMs: number;
  message: string;
  vehiclesCount?: number;
  sampleRates?: Array<{ name: string; price: number; bodyType: string }>;
}

const SETTINGS_KEY = 'wheelseye_config';
const DEFAULT_WHEELSEYE_TOKEN = 'ae4f3562-8c95-4057-9839-57176177e49b';
const DEFAULT_USER_CODE = 'WE9228053';
const DEFAULT_SESSION_ID = 'cb3c5bae-f4bb-4b15-80b4-f5fc5f95aa81';
const DEFAULT_DEVICE_ID = '33fa2d55-6154-48f3-83a0-24e122254332';
const DEFAULT_PRICING_URL = 'https://consigner.wheelseye.com/consigner/v5/demand/vehicle-list';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36';

let cachedConfig: WheelseyeConfig | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 15_000;

/**
 * Extracts Wheelseye credentials from raw browser DevTools headers, cURL commands, or JSON.
 */
export function parseRawHeaders(raw: string): Partial<WheelseyeConfig> {
  const result: Partial<WheelseyeConfig> = {};
  if (!raw || typeof raw !== 'string') return result;

  // 1. Try parsing JSON format
  try {
    const json = JSON.parse(raw);
    if (typeof json === 'object' && json !== null) {
      if (json.token) result.token = String(json.token).trim();
      if (json.user_code || json.userCode) result.user_code = String(json.user_code || json.userCode).trim();
      if (json['session-id'] || json.session_id || json.sessionId) {
        result.session_id = String(json['session-id'] || json.session_id || json.sessionId).trim();
      }
      if (json['device-id'] || json.device_id || json.deviceId || json['x-device-id']) {
        result.device_id = String(json['device-id'] || json.device_id || json.deviceId || json['x-device-id']).trim();
      }
      if (json['user-agent'] || json.userAgent) result.user_agent = String(json['user-agent'] || json.userAgent).trim();
      if (Object.keys(result).length > 0) return result;
    }
  } catch {
    // Not JSON, continue with line-by-line parsing
  }

  // 2. Line-by-line parsing for DevTools headers or cURL
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for cURL URL
    const urlMatch = trimmed.match(/curl\s+['"]?(https:\/\/[^\s'"]+)/i);
    if (urlMatch && urlMatch[1].includes('wheelseye')) {
      result.pricing_url = urlMatch[1];
    }

    // Clean line of cURL flags (-H, --header)
    const cleanLine = trimmed
      .replace(/^-(?:H|-header)\s+['"]?/, '')
      .replace(/['"]?\s*\\?$/, '');

    const colonIdx = cleanLine.indexOf(':');
    const eqIdx = cleanLine.indexOf('=');
    let key = '';
    let val = '';

    if (colonIdx > 0 && (eqIdx === -1 || colonIdx < eqIdx)) {
      key = cleanLine.slice(0, colonIdx).trim().toLowerCase();
      val = cleanLine.slice(colonIdx + 1).trim();
    } else if (eqIdx > 0) {
      key = cleanLine.slice(0, eqIdx).trim().toLowerCase();
      val = cleanLine.slice(eqIdx + 1).trim();
    }

    key = key.replace(/^:+/, '').replace(/^['"]+|['"]+$/g, '');
    val = val.replace(/^['"]+|['"]+$/g, '');

    if (key === 'token') {
      result.token = val;
    } else if (key === 'user_code' || key === 'usercode') {
      result.user_code = val;
    } else if (key === 'session-id' || key === 'session_id' || key === 'sessionid') {
      result.session_id = val;
    } else if (key === 'device-id' || key === 'device_id' || key === 'deviceid' || key === 'x-device-id') {
      result.device_id = val;
    } else if (key === 'user-agent' || key === 'useragent') {
      result.user_agent = val;
    }
  }

  // 3. Fallback regex search for UUIDs/codes if raw is unstructured
  if (!result.token) {
    const tokenMatch = raw.match(/token['":=\s]+([a-f0-9-]{36})/i);
    if (tokenMatch) result.token = tokenMatch[1];
  }
  if (!result.user_code) {
    const userCodeMatch = raw.match(/user_code['":=\s]+(WE\d+)/i);
    if (userCodeMatch) result.user_code = userCodeMatch[1];
  }
  if (!result.session_id) {
    const sessionMatch = raw.match(/session-?id['":=\s]+([a-f0-9-]{36})/i);
    if (sessionMatch) result.session_id = sessionMatch[1];
  }
  if (!result.device_id) {
    const deviceMatch = raw.match(/device-?id['":=\s]+([a-f0-9-]{36})/i);
    if (deviceMatch) result.device_id = deviceMatch[1];
  }

  return result;
}

export function getWheelseyeHeaders(configOrToken?: Partial<WheelseyeConfig> | string) {
  let activeToken = DEFAULT_WHEELSEYE_TOKEN;
  let activeUserCode = DEFAULT_USER_CODE;
  let activeSessionId = DEFAULT_SESSION_ID;
  let activeDeviceId = DEFAULT_DEVICE_ID;
  let activeUserAgent = DEFAULT_USER_AGENT;

  if (typeof configOrToken === 'string') {
    activeToken = configOrToken || process.env.WHEELSEYE_TOKEN || DEFAULT_WHEELSEYE_TOKEN;
  } else if (configOrToken && typeof configOrToken === 'object') {
    activeToken = configOrToken.token || process.env.WHEELSEYE_TOKEN || DEFAULT_WHEELSEYE_TOKEN;
    activeUserCode = configOrToken.user_code || DEFAULT_USER_CODE;
    activeSessionId = configOrToken.session_id || DEFAULT_SESSION_ID;
    activeDeviceId = configOrToken.device_id || DEFAULT_DEVICE_ID;
    activeUserAgent = configOrToken.user_agent || DEFAULT_USER_AGENT;
  } else if (cachedConfig) {
    activeToken = cachedConfig.token;
    activeUserCode = cachedConfig.user_code;
    activeSessionId = cachedConfig.session_id;
    activeDeviceId = cachedConfig.device_id;
    activeUserAgent = cachedConfig.user_agent;
  } else {
    activeToken = process.env.WHEELSEYE_TOKEN || DEFAULT_WHEELSEYE_TOKEN;
  }

  return {
    'accept': 'application/json',
    'content-type': 'application/json',
    'device-id': activeDeviceId,
    'locale': 'en',
    'origin': 'https://wheelseye.com',
    'referer': 'https://wheelseye.com/',
    'sec-ch-ua': '"Chromium";v="154", "Google Chrome";v="154", "Not A(Brand";v="99"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'service': 'Consigner',
    'session-id': activeSessionId,
    'token': activeToken,
    'user-agent': activeUserAgent,
    'user_code': activeUserCode,
    'x-app-code': '1',
    'x-app-platform': 'CONSIGNER_WEB',
    'x-app-version': '2.4.3',
    'x-device-id': activeDeviceId,
    'x-os-version': '',
    'x-requested-with': 'XMLHttpRequest',
    'x-utm-campaign': '',
    'x-utm-medium': 'organic',
    'x-utm-source': 'organic'
  };
}

export const wheelseyeService = {
  /**
   * Get the active configuration from memory cache or database, falling back to environment defaults.
   */
  async getConfig(): Promise<WheelseyeConfig> {
    if (cachedConfig && Date.now() < cacheExpiresAt) {
      return cachedConfig;
    }

    try {
      const { data, error } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', SETTINGS_KEY)
        .maybeSingle();

      if (!error && data?.value && typeof data.value === 'object') {
        const val = data.value as Partial<WheelseyeConfig>;
        cachedConfig = {
          enabled: val.enabled ?? settings.WHEELSEYE_MARKET_BENCHMARK_ENABLED,
          token: val.token || process.env.WHEELSEYE_TOKEN || DEFAULT_WHEELSEYE_TOKEN,
          user_code: val.user_code || DEFAULT_USER_CODE,
          session_id: val.session_id || DEFAULT_SESSION_ID,
          device_id: val.device_id || DEFAULT_DEVICE_ID,
          pricing_url: val.pricing_url || DEFAULT_PRICING_URL,
          user_agent: val.user_agent || DEFAULT_USER_AGENT,
          updated_at: val.updated_at,
          updated_by: val.updated_by,
          last_tested_at: val.last_tested_at,
          last_test_status: val.last_test_status,
          last_test_message: val.last_test_message,
          last_test_latency_ms: val.last_test_latency_ms,
          last_test_result: val.last_test_result,
        };
        cacheExpiresAt = Date.now() + CACHE_TTL_MS;
        return cachedConfig;
      }
    } catch (err: any) {
      console.warn('[WheelsEye] Failed to read settings from DB, using env defaults:', err.message);
    }

    cachedConfig = {
      enabled: settings.WHEELSEYE_MARKET_BENCHMARK_ENABLED,
      token: process.env.WHEELSEYE_TOKEN || DEFAULT_WHEELSEYE_TOKEN,
      user_code: DEFAULT_USER_CODE,
      session_id: DEFAULT_SESSION_ID,
      device_id: DEFAULT_DEVICE_ID,
      pricing_url: DEFAULT_PRICING_URL,
      user_agent: DEFAULT_USER_AGENT,
    };
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    return cachedConfig;
  },

  /**
   * Save configuration updates to system_settings and update the in-memory cache instantly.
   */
  async saveConfig(updates: Partial<WheelseyeConfig>, userId?: string): Promise<WheelseyeConfig> {
    const current = await this.getConfig();
    const now = new Date().toISOString();
    const updated: WheelseyeConfig = {
      ...current,
      ...updates,
      updated_at: now,
      ...(userId ? { updated_by: userId } : {})
    };

    const { error } = await supabase
      .from('system_settings')
      .upsert({ key: SETTINGS_KEY, value: updated, updated_at: now }, { onConflict: 'key' });

    if (error) {
      console.error('[WheelsEye] Failed to save config to system_settings:', error.message);
      throw new Error(`Failed to save Rate API settings: ${error.message}`);
    }

    cachedConfig = updated;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    return updated;
  },

  /**
   * Record operational status (e.g. rate limit 429 or unauthorized 401) without throwing.
   */
  async recordStatus(
    status: 'ok' | 'rate_limited' | 'unauthorized' | 'error',
    message: string,
    latencyMs?: number,
    result?: WheelseyeConfig['last_test_result']
  ): Promise<void> {
    try {
      const current = await this.getConfig();
      const updated: WheelseyeConfig = {
        ...current,
        last_tested_at: new Date().toISOString(),
        last_test_status: status,
        last_test_message: message,
        ...(latencyMs != null ? { last_test_latency_ms: latencyMs } : {}),
        ...(result ? { last_test_result: result } : {})
      };

      cachedConfig = updated;
      cacheExpiresAt = Date.now() + CACHE_TTL_MS;

      // Background write to DB
      supabase
        .from('system_settings')
        .upsert({ key: SETTINGS_KEY, value: updated, updated_at: new Date().toISOString() }, { onConflict: 'key' })
        .then(({ error }) => {
          if (error) console.warn('[WheelsEye] Could not record status in DB:', error.message);
        });
    } catch (e: any) {
      console.warn('[WheelsEye] recordStatus error:', e.message);
    }
  },

  /**
   * Test the configuration live against WheelsEye vehicle list API.
   */
  async testConfig(overrideConfig?: Partial<WheelseyeConfig>): Promise<WheelseyeTestResult> {
    const active = await this.getConfig();
    const configToTest: WheelseyeConfig = {
      ...active,
      ...(overrideConfig || {})
    };

    const targetUrl = configToTest.pricing_url || DEFAULT_PRICING_URL;
    const testPayload: WheelseyePricePayload = {
      locs: [
        {
          placeId: 'ChIJR3_7W5-7wjsRjYj2x8b659c', // Pune, Maharashtra
          address: 'Pune, Maharashtra, India',
          name: 'Pune',
          source: 'GOOGLE',
          addressSummary: 'Pune, Maharashtra, India',
          loc: { lat: 18.5204, lng: 73.8567 },
          buildingName: 'Pune',
          addressLineOne: 'Pune, Maharashtra, India',
          pincode: '411001',
          type: 'LOADING',
          title: { buildingName: 'Pune', addressLineOne: 'Pune, Maharashtra, India' }
        },
        {
          placeId: 'ChIJ595yE0-YwjsRuN51uYqW43c', // Nashik, Maharashtra
          address: 'Nashik, Maharashtra, India',
          name: 'Nashik',
          source: 'GOOGLE',
          addressSummary: 'Nashik, Maharashtra, India',
          loc: { lat: 19.9975, lng: 73.7898 },
          buildingName: 'Nashik',
          addressLineOne: 'Nashik, Maharashtra, India',
          pincode: '422001',
          type: 'CONSIGNEE',
          title: { buildingName: 'Nashik', addressLineOne: 'Nashik, Maharashtra, India' }
        }
      ],
      tonnage: 12,
      bodyType: 'OPEN'
    };

    const startTime = Date.now();
    try {
      const response = await axios.post(targetUrl, testPayload, {
        headers: getWheelseyeHeaders(configToTest),
        timeout: 12000
      });

      const latencyMs = Date.now() - startTime;
      const vehicleList: any[] = response.data?.vehicleType || [];
      const sampleRates = vehicleList.slice(0, 5).map(v => ({
        name: v.vehicleName || 'Truck',
        price: v.finalPrice || v.price || 0,
        bodyType: v.bodyType || 'OPEN'
      }));

      const message = `200 OK — Connected successfully (${vehicleList.length} truck types returned)`;
      await this.recordStatus('ok', message, latencyMs, {
        vehicles_count: vehicleList.length,
        sample_rates: sampleRates
      });

      return {
        success: true,
        status: 200,
        latencyMs,
        message,
        vehiclesCount: vehicleList.length,
        sampleRates
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      const status = err.response?.status || 500;
      let statusKind: 'rate_limited' | 'unauthorized' | 'error' = 'error';
      let message = err.message || 'Connection failed';

      if (status === 429) {
        statusKind = 'rate_limited';
        message = 'HTTP 429: Rate limit reached on WheelsEye. Token quota exceeded.';
      } else if (status === 401 || status === 403) {
        statusKind = 'unauthorized';
        message = `HTTP ${status}: WheelsEye session token has expired or is unauthorized.`;
      } else if (err.response?.data?.message) {
        message = `HTTP ${status}: ${err.response.data.message}`;
      }

      await this.recordStatus(statusKind, message, latencyMs);

      return {
        success: false,
        status,
        latencyMs,
        message
      };
    }
  },

  /**
   * Search for locations via WheelsEye place autocomplete
   */
  async autocomplete(query: string, addressType: string = 'CONSIGNEE'): Promise<WheelseyePlaceSuggestion[]> {
    const config = await this.getConfig();
    if (!config.enabled) return [];

    const url = `https://consigner.wheelseye.com/consigner/v2/location/place/autocomplete?query=${encodeURIComponent(query)}&addressType=${encodeURIComponent(addressType)}`;

    try {
      const response = await axios.get(url, {
        headers: getWheelseyeHeaders(config),
        timeout: 10000
      });
      return response.data?.suggestions || [];
    } catch (err: any) {
      if (err.response?.status === 429) {
        this.recordStatus('rate_limited', 'HTTP 429: Rate limit on autocomplete');
      } else if (err.response?.status === 401) {
        this.recordStatus('unauthorized', 'HTTP 401: Token expired on autocomplete');
      }
      throw err;
    }
  },

  /**
   * Resolve coordinates and pincode for a place using Google Places Details API
   * with fallback to ArcGIS geocoder if Google API key is missing or fails.
   */
  async resolvePlace(placeId: string, fullAddress?: string): Promise<{
    lat: number;
    lng: number;
    pincode: string;
    buildingName: string;
    addressLineOne: string;
  }> {
    // 1. Try Google Places Details API if key exists
    if (settings.GOOGLE_MAPS_API_KEY && placeId) {
      try {
        const googleUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=geometry,address_components,name,formatted_address&key=${settings.GOOGLE_MAPS_API_KEY}`;
        const gRes = await axios.get(googleUrl, { timeout: 8000 });
        if (gRes.data?.status === 'OK' && gRes.data?.result) {
          const res = gRes.data.result;
          const lat = res.geometry?.location?.lat;
          const lng = res.geometry?.location?.lng;
          
          let pincode = '';
          for (const comp of (res.address_components || [])) {
            if (comp.types?.includes('postal_code')) {
              pincode = comp.long_name || comp.short_name;
              break;
            }
          }

          if (lat != null && lng != null) {
            return {
              lat,
              lng,
              pincode: pincode || '',
              buildingName: res.name || (fullAddress ? fullAddress.split(',')[0] : 'Location'),
              addressLineOne: res.formatted_address || fullAddress || ''
            };
          }
        }
      } catch (err: any) {
        console.warn('Google Places Details failed, falling back to ArcGIS:', err.message);
      }
    }

    // 2. Fallback to ArcGIS Geocoder using fullAddress
    const addressToGeocode = fullAddress || '';
    if (addressToGeocode) {
      try {
        const arcgisUrl = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?SingleLine=${encodeURIComponent(addressToGeocode)}&outFields=Postal,Place_addr&countryCode=IND&f=json`;
        const aRes = await axios.get(arcgisUrl, { timeout: 8000 });
        const candidate = aRes.data?.candidates?.[0];
        if (candidate?.location) {
          const postal = candidate.attributes?.Postal || '';
          return {
            lat: candidate.location.y,
            lng: candidate.location.x,
            pincode: /^\d{6}$/.test(postal) ? postal : '',
            buildingName: addressToGeocode.split(',')[0].trim(),
            addressLineOne: addressToGeocode
          };
        }
      } catch (err: any) {
        console.error('ArcGIS fallback geocoding failed:', err.message);
      }
    }

    throw new Error(`Unable to resolve coordinates for placeId: ${placeId}`);
  },

  /**
   * Helper to build a complete WheelseyeLocItem
   */
  async buildLocItem(
    suggestion: WheelseyePlaceSuggestion,
    type: 'LOADING' | 'CONSIGNEE'
  ): Promise<WheelseyeLocItem> {
    const fullAddress = [suggestion.addressLineOne, suggestion.addressLineTwo, suggestion.addressLineThree]
      .filter(Boolean)
      .join(', ');

    if (suggestion.loc?.lat != null && suggestion.loc?.lng != null && suggestion.pincode) {
      const name = suggestion.addressLineOne || fullAddress.split(',')[0];
      return {
        placeId: suggestion.placeId,
        address: fullAddress,
        name,
        source: suggestion.source,
        addressSummary: fullAddress,
        loc: suggestion.loc,
        buildingName: name,
        addressLineOne: fullAddress,
        pincode: suggestion.pincode,
        type,
        title: {
          buildingName: name,
          addressLineOne: fullAddress
        }
      };
    }

    const resolved = await this.resolvePlace(suggestion.placeId, fullAddress);
    return {
      placeId: suggestion.placeId,
      address: fullAddress,
      name: resolved.buildingName,
      source: suggestion.source,
      addressSummary: fullAddress,
      loc: { lat: resolved.lat, lng: resolved.lng },
      buildingName: resolved.buildingName,
      addressLineOne: resolved.addressLineOne || fullAddress,
      pincode: resolved.pincode,
      type,
      title: {
        buildingName: resolved.buildingName,
        addressLineOne: resolved.addressLineOne || fullAddress
      }
    };
  },

  /**
   * Call the WheelsEye Pricing Recommendation / Vehicle List API
   */
  async getPricingRecommendations(payload: WheelseyePricePayload, endpointUrl?: string): Promise<any> {
    const config = await this.getConfig();
    if (!config.enabled) {
      throw new Error('WheelsEye rate benchmark is disabled');
    }

    const targetUrl = endpointUrl || config.pricing_url || DEFAULT_PRICING_URL;

    try {
      const response = await axios.post(targetUrl, payload, {
        headers: getWheelseyeHeaders(config),
        timeout: 15000
      });

      return response.data;
    } catch (err: any) {
      if (err.response?.status === 429) {
        this.recordStatus('rate_limited', 'HTTP 429: Rate limit reached on demand vehicle-list');
      } else if (err.response?.status === 401 || err.response?.status === 403) {
        this.recordStatus('unauthorized', `HTTP ${err.response.status}: Token expired on vehicle-list`);
      }
      throw err;
    }
  },

  /**
   * One-stop quote helper: takes origin & destination suggestion/place details,
   * resolves coordinates and pincodes automatically, and returns vehicle pricing recommendations.
   */
  async getQuoteFromSuggestions(
    origin: { placeId: string; address?: string; loc?: { lat: number; lng: number }; pincode?: string; name?: string },
    destination: { placeId: string; address?: string; loc?: { lat: number; lng: number }; pincode?: string; name?: string },
    tonnage: number = 12,
    bodyType: string = 'OPEN'
  ): Promise<any> {
    let originLoc = origin.loc;
    let originPin = origin.pincode;
    let originAddr = origin.address || '';
    let originName = origin.name || originAddr.split(',')[0];

    if (!originLoc || !originPin) {
      const resolved = await this.resolvePlace(origin.placeId, originAddr);
      originLoc = { lat: resolved.lat, lng: resolved.lng };
      originPin = resolved.pincode;
      originAddr = resolved.addressLineOne || originAddr;
      originName = resolved.buildingName || originName;
    }

    let destLoc = destination.loc;
    let destPin = destination.pincode;
    let destAddr = destination.address || '';
    let destName = destination.name || destAddr.split(',')[0];

    if (!destLoc || !destPin) {
      const resolved = await this.resolvePlace(destination.placeId, destAddr);
      destLoc = { lat: resolved.lat, lng: resolved.lng };
      destPin = resolved.pincode;
      destAddr = resolved.addressLineOne || destAddr;
      destName = resolved.buildingName || destName;
    }

    const payload: WheelseyePricePayload = {
      locs: [
        {
          placeId: origin.placeId,
          address: originAddr,
          name: originName,
          source: 'GOOGLE',
          addressSummary: originAddr,
          loc: originLoc,
          buildingName: originName,
          addressLineOne: originAddr,
          pincode: originPin || '',
          type: 'LOADING',
          title: { buildingName: originName, addressLineOne: originAddr }
        },
        {
          placeId: destination.placeId,
          address: destAddr,
          name: destName,
          source: 'GOOGLE',
          addressSummary: destAddr,
          loc: destLoc,
          buildingName: destName,
          addressLineOne: destAddr,
          pincode: destPin || '',
          type: 'CONSIGNEE',
          title: { buildingName: destName, addressLineOne: destAddr }
        }
      ],
      tonnage,
      bodyType
    };

    return this.getPricingRecommendations(payload);
  }
};

