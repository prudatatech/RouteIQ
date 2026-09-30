import type { DraftShipmentData } from '@/store/draftStore'
import { toShipmentDrops } from '@/services/cargoMap'
import { haversineKm } from '../format'
import { declaredValueOf, draftDropsBalance, todayIso } from './validation'

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
 * Where the shipment ends: the destination, or with several drops the last one (the drops are
 * visited nearest-first from the pickup, so the last is the farthest along the way).
 */
export function finalDropOf(data: DraftShipmentData): { name: string; address: string; lat: number; lng: number } | null {
  if (!data.multi_drop) {
    return data.dest_lat && data.dest_lng
      ? { name: data.delivery_point_name, address: data.delivery_point_address, lat: data.dest_lat, lng: data.dest_lng }
      : null
  }
  const ordered = nearestFirst(data.origin_lat, data.origin_lng, (data.drops ?? []).filter(d => d.lat && d.lng))
  const last = ordered[ordered.length - 1]
  return last ? { name: last.consignee_name || last.name, address: last.address, lat: last.lat, lng: last.lng } : null
}

/** Places ordered nearest-first from a start point, each next one nearest to the last. */
function nearestFirst<T extends { lat: number; lng: number }>(lat: number, lng: number, places: T[]): T[] {
  const left = [...places]
  const out: T[] = []
  let curLat = lat
  let curLng = lng
  while (left.length > 0 && curLat && curLng) {
    let best = 0
    let min = Infinity
    left.forEach((p, i) => {
      const d = haversineKm(curLat, curLng, p.lat, p.lng)
      if (d < min) { min = d; best = i }
    })
    const next = left.splice(best, 1)[0]
    out.push(next)
    curLat = next.lat
    curLng = next.lng
  }
  return [...out, ...left]
}

/**
 * `drops[]` of a multi-drop booking: each drop with its consignee and pieces, and the weight that
 * follows its pieces (or was typed). A drop's declared value is sent only when one was typed;
 * otherwise the backend shares the value by pieces, as the form showed.
 */
export function buildDrops(data: DraftShipmentData) {
  const drops = data.drops ?? []
  const balance = draftDropsBalance(data)
  const anyValueTyped = balance.rows.some(r => r.valueTyped)
  return toShipmentDrops(drops.map((d, i) => ({
    address: d.address,
    lat: d.lat,
    lng: d.lng,
    consignee_name: d.consignee_name,
    consignee_phone: d.consignee_phone.replace(/[\s-]/g, ''),
    consignee_gstin: d.consignee_gstin,
    pieces: balance.rows[i].pieces ?? 0,
    weight_kg: balance.rows[i].weight_kg,
    declared_value: anyValueTyped ? balance.rows[i].declared_value : null,
  })))
}

/**
 * The body for POST /shipments (backend-ts ShipmentCreateSchema). Extra stops are ordered
 * nearest-first from the pickup; the destination is always the last drop. With several drops,
 * `drops[]` is sent and the backend makes the master with one lot per drop.
 */
export function buildShipmentPayload(data: DraftShipmentData) {
  const multi = !!data.multi_drop && (data.drops ?? []).length > 1
  const unvisited = (multi ? [] : data.stops || []).map(s => ({ ...s }))
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

  const final = finalDropOf(data)
  if (multi) {
    // The route runs through every drop, nearest-first
    for (const d of nearestFirst(data.origin_lat, data.origin_lng, (data.drops ?? []).filter(x => x.lat && x.lng))) {
      if (currLat && currLng) totalKm += haversineKm(currLat, currLng, d.lat, d.lng)
      currLat = d.lat
      currLng = d.lng
    }
  } else if (final && currLat && currLng) {
    totalKm += haversineKm(currLat, currLng, final.lat, final.lng)
  }

  const etaDetails = (() => {
    if (!data.origin_lat || !final) return { distance_km: null, eta_text: null }
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
    dest_name: final?.name ?? data.delivery_point_name,
    dest_address: final?.address ?? data.delivery_point_address,
    dest_lat: final?.lat ?? data.dest_lat,
    dest_lng: final?.lng ?? data.dest_lng,
    ...(multi ? { drops: buildDrops(data) } : {}),
    ...(declaredValueOf(data) != null ? { declared_value: declaredValueOf(data) } : {}),
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
    freight_charge: data.freight_charge && Number(data.freight_charge) >= 0 ? Number(data.freight_charge) : null,
    asking_price: data.open_bidding ? (data.asking_price ? Number(data.asking_price) : null) : null,
    metadata: {
      dispatch_date: data.plan_for_later && data.scheduled_date ? data.scheduled_date : todayIso(),
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
