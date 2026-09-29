import type { DraftShipmentData } from '@/store/draftStore'
import { haversineKm } from '../format'

export const CARGO_TYPES = [
  { id: 'standard', name: 'Standard parcel', description: 'Boxed goods with no special handling' },
  { id: 'heavy', name: 'Heavy freight', description: 'Bulk or industrial cargo' },
  { id: 'cold_chain', name: 'Cold chain', description: 'Needs temperature control' },
  { id: 'hazardous', name: 'Hazardous', description: 'Needs special handling and paperwork' },
] as const

/** Names stored in the manifest; unchanged from the previous form so existing records read the same. */
const MANIFEST_CATEGORY: Record<string, string> = {
  standard: 'Standard Parcel',
  heavy: 'Heavy Freight',
  cold_chain: 'Cold Chain',
  hazardous: 'Hazardous',
}

/** Volumetric weight in kg for one parcel (L × W × H cm ÷ 5000). */
export const volumetricKg = (d: Pick<DraftShipmentData, 'length_cm' | 'width_cm' | 'height_cm'>) =>
  (Number(d.length_cm) * Number(d.width_cm) * Number(d.height_cm)) / 5000

/** Chargeable weight: the larger of actual and volumetric weight. */
export const chargeableKg = (d: DraftShipmentData) => Math.max(Number(d.total_weight_kg), volumetricKg(d))

/**
 * The body for POST /shipments (backend-ts ShipmentCreateSchema). Extra stops are ordered
 * nearest-first from the pickup; the destination is always the last drop.
 */
export function buildShipmentPayload(data: DraftShipmentData) {
  const unvisited = (data.stops || []).map(s => ({ ...s }))
  const orderedStops: typeof unvisited = []
  let currLat = data.origin_lat
  let currLng = data.origin_lng
  let totalKm = 0

  while (unvisited.length > 0 && currLat && currLng) {
    let nearest = 0
    let min = Infinity
    unvisited.forEach((stop, i) => {
      if (!stop.lat || !stop.lng) return
      const d = haversineKm(currLat, currLng, stop.lat, stop.lng)
      if (d < min) { min = d; nearest = i }
    })
    if (min === Infinity) break
    const next = unvisited.splice(nearest, 1)[0]
    orderedStops.push(next)
    totalKm += min
    currLat = next.lat
    currLng = next.lng
  }

  if (data.dest_lat && data.dest_lng && currLat && currLng) {
    totalKm += haversineKm(currLat, currLng, data.dest_lat, data.dest_lng)
  }

  const etaDetails = (() => {
    if (!data.origin_lat || !data.dest_lat) return { distance_km: null, eta_text: null }
    const hours = totalKm / 40 // 40 km/h average commercial speed
    const eta = new Date()
    eta.setHours(eta.getHours() + hours)
    return { distance_km: totalKm.toFixed(1), eta_text: `${eta.toISOString().split('T')[0]} (Est.)` }
  })()

  return {
    stops: orderedStops,
    origin_name: data.origin_name,
    origin_address: data.origin_address,
    origin_lat: data.origin_lat,
    origin_lng: data.origin_lng,
    dest_name: data.delivery_point_name,
    dest_address: data.delivery_point_address,
    dest_lat: data.dest_lat,
    dest_lng: data.dest_lng,
    total_items: Number(data.total_items),
    total_weight_kg: Number(data.total_weight_kg),
    declared_load_kg: chargeableKg(data),
    priority: data.priority,
    enable_mobile_gps: data.enable_mobile_gps,
    vehicle_id: data.selectedVehicleId || null,
    parcels: [{
      weight_kg: Number(data.total_weight_kg),
      length_cm: Number(data.length_cm),
      width_cm: Number(data.width_cm),
      height_cm: Number(data.height_cm),
      category: data.cargo_type,
      is_hazardous: data.cargo_type === 'hazardous',
      is_fragile: false,
    }],
    open_bidding: data.open_bidding,
    bidding_opens_at: data.open_bidding ? new Date().toISOString() : null,
    bidding_closes_at: data.open_bidding ? new Date(Date.now() + (data.bidding_duration_mins || 5) * 60000).toISOString() : null,
    asking_price: data.open_bidding ? (data.asking_price ? Number(data.asking_price) : null) : null,
    metadata: {
      dispatch_date: data.plan_for_later && data.scheduled_date ? data.scheduled_date : new Date().toISOString().split('T')[0],
      productCategory: MANIFEST_CATEGORY[data.cargo_type] ?? 'General Cargo',
      noOfPackages: String(data.total_items),
      grossWeight: `${data.total_weight_kg} KG`,
      transporter_signature: data.selectedVehicleId ? 'Auto-Signed at Dispatch' : null,
      eta_details: etaDetails,
      specialHandling: {
        fragile: false,
        hazardous: data.cargo_type === 'hazardous',
        coldChain: data.cargo_type === 'cold_chain',
        stackable: true,
        highValue: data.priority === 'high' || data.priority === 'critical',
        longHaul: false,
      },
    },
  }
}
