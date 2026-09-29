/**
 * Place search for address inputs (ArcGIS World Geocoding, India only).
 */

const ARCGIS_GEOCODER = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer'

/** Address parts the geocoder returns, used to fill city/state/PIN fields. */
const ADDRESS_FIELDS = 'Place_addr,Neighborhood,City,Subregion,District,Region,Postal'

export interface PlaceSuggestion {
  id: string
  text: string
  place_name: string
  magicKey: string
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
 * Up to six suggestions for a partial address; empty for queries under 3 characters.
 * `near` ranks places close to that point first (for example the user's location).
 */
export async function suggestPlaces(
  query: string,
  signal?: AbortSignal,
  near?: { lat: number; lng: number } | null,
): Promise<PlaceSuggestion[]> {
  if (!query || query.trim().length < 3) return []
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
