import axios from 'axios';
import { settings } from '../core/config';

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

const DEFAULT_WHEELSEYE_TOKEN = '0825b253-6131-4dc8-8da7-0636c4f55007';

export function getWheelseyeHeaders(token?: string) {
  const activeToken = token || process.env.WHEELSEYE_TOKEN || DEFAULT_WHEELSEYE_TOKEN;
  return {
    'accept': 'application/json',
    'content-type': 'application/json',
    'device-id': '663a7765-28a1-43ff-b323-6fdd9571ba32',
    'locale': 'en',
    'origin': 'https://wheelseye.com',
    'referer': 'https://wheelseye.com/',
    'sec-ch-ua': '"Google Chrome";v="155", "Chromium";v="155", "Not(A:Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'service': 'Consigner',
    'session-id': '0aa52302-380d-462f-a955-93dc0bb8ae56',
    'token': activeToken,
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
    'user_code': 'WE9216873',
    'x-app-code': '1',
    'x-app-platform': 'CONSIGNER_WEB',
    'x-app-version': '2.4.3',
    'x-device-id': '663a7765-28a1-43ff-b323-6fdd9571ba32',
    'x-os-version': '',
    'x-requested-with': 'XMLHttpRequest',
    'x-utm-campaign': '',
    'x-utm-medium': 'organic',
    'x-utm-source': 'organic'
  };
}

export const wheelseyeService = {
  /**
   * Search for locations via WheelsEye place autocomplete
   */
  async autocomplete(query: string, addressType: string = 'CONSIGNEE'): Promise<WheelseyePlaceSuggestion[]> {
    const token = process.env.WHEELSEYE_TOKEN || DEFAULT_WHEELSEYE_TOKEN;
    const url = `https://consigner.wheelseye.com/consigner/v2/location/place/autocomplete?query=${encodeURIComponent(query)}&addressType=${encodeURIComponent(addressType)}`;

    const response = await axios.get(url, {
      headers: getWheelseyeHeaders(token),
      timeout: 10000
    });

    return response.data?.suggestions || [];
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

    // If suggestion already contains loc and pincode (e.g. source: RECENT)
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

    // Resolve via Google / Geocoder
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
    const targetUrl = endpointUrl || process.env.WHEELSEYE_PRICING_URL || 'https://consigner.wheelseye.com/consigner/v5/demand/vehicle-list';
    const token = process.env.WHEELSEYE_TOKEN || DEFAULT_WHEELSEYE_TOKEN;

    const response = await axios.post(targetUrl, payload, {
      headers: getWheelseyeHeaders(token),
      timeout: 15000
    });

    return response.data;
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
    // Resolve origin
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

    // Resolve destination
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
