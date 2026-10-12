/**
 * Place search for address inputs (ArcGIS World Geocoding, India only).
 */

const ARCGIS_GEOCODER = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer'

/** Address parts the geocoder returns, used to fill city/state/PIN fields. */
const ADDRESS_FIELDS = 'Place_addr,Neighborhood,City,Subregion,District,Region,Postal'

import { wheelseyeAPI } from './api'

export interface PlaceSuggestion {
  id: string
  text: string
  place_name: string
  magicKey: string
  placeId?: string
  source?: string
}

export interface AddressParts {
  locality: string | null
  city: string | null
  district: string | null
  state: string | null
  pincode: string | null
}

export interface ResolvedPlace {
  address: string
  lat: number
  lng: number
  /** Present when the geocoder returned address details. */
  parts?: AddressParts
  placeId?: string
}

interface ArcgisAttributes {
  Neighborhood?: string
  City?: string
  Subregion?: string
  District?: string
  Region?: string
  Postal?: string
}

const clean = (value: string | undefined) => (value && value.trim() ? value.trim() : null)

function toParts(a: ArcgisAttributes | undefined): AddressParts | undefined {
  if (!a) return undefined
  const postal = clean(a.Postal)
  return {
    locality: clean(a.Neighborhood) ?? clean(a.District),
    city: clean(a.City) ?? clean(a.Subregion),
    district: clean(a.Subregion),
    state: clean(a.Region),
    pincode: postal && /^\d{6}$/.test(postal) ? postal : null,
  }
}

async function getJson(url: string, signal?: AbortSignal) {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Place lookup failed (${res.status})`)
  return res.json()
}

/**
 * Suggestions for a partial address (India).
 * Queries WheelsEye location intelligence (Google Places) first, falling back to ArcGIS.
 */
export async function suggestPlaces(
  query: string,
  signal?: AbortSignal,
  near?: { lat: number; lng: number } | null,
): Promise<PlaceSuggestion[]> {
  if (!query || query.trim().length < 3) return []

  // 1. Primary: WheelsEye location autocomplete (Google Places backed)
  try {
    const list = await wheelseyeAPI.autocomplete(query.trim())
    if (Array.isArray(list) && list.length > 0) {
      return list.map((s: any) => {
        const full = [s.addressLineOne, s.addressLineTwo, s.addressLineThree].filter(Boolean).join(', ')
        return {
          id: s.placeId || full,
          text: s.addressLineOne || full.split(',')[0],
          place_name: full,
          magicKey: s.placeId || '',
          placeId: s.placeId,
          source: 'wheelseye',
        }
      })
    }
  } catch {
    // Fall back to ArcGIS
  }

  // 2. Fallback: ArcGIS World Geocoding
  const bias = near ? `&location=${near.lng},${near.lat}` : ''
  const data = await getJson(
    `${ARCGIS_GEOCODER}/suggest?text=${encodeURIComponent(query.trim())}&countryCode=IND&maxSuggestions=6${bias}&f=json`,
    signal,
  )
  return (data.suggestions ?? []).map((s: { magicKey: string; text: string }) => ({
    id: s.magicKey,
    text: s.text.split(', ')[0],
    place_name: s.text,
    magicKey: s.magicKey,
  }))
}

/** Coordinates and address parts for a chosen suggestion, or null when the geocoder has no match. */
export async function resolvePlace(suggestion: PlaceSuggestion): Promise<ResolvedPlace | null> {
  // 1. Resolve WheelsEye suggestion if placeId is present
  if (suggestion.placeId) {
    try {
      const res = await wheelseyeAPI.resolve(suggestion.placeId, suggestion.place_name)
      if (res && typeof res.lat === 'number' && typeof res.lng === 'number') {
        const parts: AddressParts = {
          locality: res.buildingName || null,
          city: res.buildingName || null,
          district: null,
          state: null,
          pincode: res.pincode || null,
        }
        return {
          address: res.addressLineOne || suggestion.place_name,
          lat: res.lat,
          lng: res.lng,
          parts,
          placeId: suggestion.placeId,
        }
      }
    } catch {
      // Fall back to ArcGIS
    }
  }

  // 2. Fallback: ArcGIS Candidate Lookup
  const lookup = async (params: string) => {
    const data = await getJson(`${ARCGIS_GEOCODER}/findAddressCandidates?${params}&outFields=${ADDRESS_FIELDS}&countryCode=IND&f=json`)
    return data.candidates?.[0] as { location?: { x: number; y: number }; attributes?: ArcgisAttributes } | undefined
  }

  const candidate = (await lookup(`magicKey=${encodeURIComponent(suggestion.magicKey)}`))
    ?? (await lookup(`SingleLine=${encodeURIComponent(suggestion.place_name)}`))
  if (!candidate?.location) return null
  return {
    address: suggestion.place_name,
    lat: candidate.location.y,
    lng: candidate.location.x,
    parts: toParts(candidate.attributes),
    placeId: suggestion.placeId,
  }
}

/** Address nearest to a coordinate (for a dropped or dragged pin), or null when the geocoder has none. */
export async function reversePlace(lat: number, lng: number): Promise<ResolvedPlace | null> {
  const data = await getJson(`${ARCGIS_GEOCODER}/reverseGeocode?location=${lng},${lat}&featureTypes=&f=json`)
  const a = data.address as (ArcgisAttributes & { LongLabel?: string; Match_addr?: string }) | undefined
  const address = a?.LongLabel || a?.Match_addr
  return address ? { address, lat, lng, parts: toParts(a) } : null
}

export class LocationError extends Error {}

/**
 * The device's current position. Rejects with a plain-language LocationError
 * when permission is denied, the position is unavailable or it takes too long.
 */
export function currentPosition(timeoutMs = 10000): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new LocationError('This browser cannot share your location.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      err => {
        const message = err.code === err.PERMISSION_DENIED
          ? 'Location access is blocked. Allow it in your browser settings, or search for the address.'
          : err.code === err.TIMEOUT
            ? 'Finding your location took too long. Try again or search for the address.'
            : 'Your location is not available right now. Search for the address instead.'
        reject(new LocationError(message))
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    )
  })
}
