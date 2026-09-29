/**
 * Place search for address inputs (ArcGIS World Geocoding, India only).
 */

const ARCGIS_GEOCODER = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer'

export interface PlaceSuggestion {
  id: string
  text: string
  place_name: string
  magicKey: string
}

export interface ResolvedPlace {
  address: string
  lat: number
  lng: number
}

/** Up to five suggestions for a partial address; empty for queries under 3 characters. */
export async function suggestPlaces(query: string, signal?: AbortSignal): Promise<PlaceSuggestion[]> {
  if (!query || query.trim().length < 3) return []
  const url = `${ARCGIS_GEOCODER}/suggest?text=${encodeURIComponent(query)}&countryCode=IND&maxSuggestions=5&f=json`
  const res = await fetch(url, { signal })
  const data = await res.json()
  return (data.suggestions ?? []).map((s: any) => ({
    id: s.magicKey,
    text: s.text.split(', ')[0],
    place_name: s.text,
    magicKey: s.magicKey,
  }))
}

/** Coordinates for a chosen suggestion, or null when the geocoder has no match. */
export async function resolvePlace(suggestion: PlaceSuggestion): Promise<ResolvedPlace | null> {
  const lookup = async (params: string) => {
    const res = await fetch(`${ARCGIS_GEOCODER}/findAddressCandidates?${params}&f=json`)
    const data = await res.json()
    return data.candidates?.[0]?.location as { x: number, y: number } | undefined
  }

  const location = (await lookup(`magicKey=${encodeURIComponent(suggestion.magicKey)}`))
    ?? (await lookup(`SingleLine=${encodeURIComponent(suggestion.place_name)}`))
  if (!location) return null
  return { address: suggestion.place_name, lat: location.y, lng: location.x }
}

/** Address nearest to a coordinate, or null when the geocoder has none. */
export async function reversePlace(lat: number, lng: number): Promise<ResolvedPlace | null> {
  const res = await fetch(`${ARCGIS_GEOCODER}/reverseGeocode?location=${lng},${lat}&f=json`)
  const data = await res.json()
  const address: string | undefined = data.address?.LongLabel || data.address?.Match_addr
  return address ? { address, lat, lng } : null
}
