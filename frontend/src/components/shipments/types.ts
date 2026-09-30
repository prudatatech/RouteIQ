/** Fields of a shipment as returned by GET /shipments (backend-ts ShipmentService.listShipments). */
export interface DeliveryPoint {
  id?: string
  name?: string | null
  address?: string | null
  latitude?: number | null
  longitude?: number | null
  route_stops?: { routes?: { vehicle_id?: string | null; vehicles?: { plate_number?: string | null } | null } | null }[]
}

export interface CapacityBidInfo {
  bid_amount?: number | null
  eway_bill_ref?: string | null
  load_configuration?: string | null
  vendor_profiles?: { company_name?: string | null; city?: string | null } | null
  capacity_windows?: { trigger_type?: string | null } | null
}

export interface ShipmentRow {
  id: string
  tracking_id: string
  /** Set on a cargo manifest that came from a vendor's posted load. */
  vendor_request_id?: string | null
  status?: string | null
  /** Who holds the goods (cargo custody): consignor, vehicle, hub or consignee. Shipments only. */
  current_holder?: string | null
  priority?: string | null
  origin_name?: string | null
  origin_address?: string | null
  origin_lat?: number | null
  origin_lng?: number | null
  total_items?: number | null
  total_weight_kg?: number | null
  created_at?: string | null
  received_by?: string | null
  signature_data?: string | null
  /** Storage paths of the delivery photo and signature; the images come from GET /shipments/:id/proof. */
  photo_url?: string | null
  signature_url?: string | null
  vehicle_id?: string | null
  driver_name?: string | null
  freight_charge?: number | null
  /** Free-form details; a customer booking sets pickup_date and dispatch_date (YYYY-MM-DD). */
  metadata?: Record<string, unknown> | null
  driver_rating?: number | null
  driver_rating_note?: string | null
  delivery_points?: DeliveryPoint[]
  /** Only set on cargo manifests merged into the list. */
  delivery_point?: DeliveryPoint
  capacity_bids?: CapacityBidInfo | null
  /** Set when the shipment was opened to vendor bids (a capacity window points at it). */
  bid_id?: string | null
  open_bidding?: boolean | null
  asking_price?: number | null
  bidding_opens_at?: string | null
  bidding_closes_at?: string | null
  // Lots (docs/cargo-plan.md "Lots"): a split consignment is a master with lots under it
  /** A master holds no goods itself; its status and pieces roll up from its lots. */
  is_master?: boolean | null
  /** Set on a lot: its master (a vendor load's lots carry `parent_manifest_id`). */
  parent_shipment_id?: string | null
  parent_manifest_id?: string | null
  lot_seq?: number | null
  /** `A`, `B`, `A1` … */
  lot_label?: string | null
  split_reason?: string | null
  declared_value?: number | null
  /** This lot's part of the master's freight_charge. */
  freight_share?: number | null
  consignee_name?: string | null
  consignee_phone?: string | null
  consignee_gstin?: string | null
}

/** One entry of GET /shipments/:id/history (backend-ts ShipmentService.getShipmentHistory). */
export interface ShipmentHistoryEvent {
  status: string
  at: string
  actor: { id: string; name: string | null; role: string | null } | null
  note: string | null
  location: { lat: number; lng: number } | null
}

/** Vehicle fields used when choosing a vehicle for a shipment. */
export interface VehicleOption {
  id: string
  plate_number: string
  status?: string | null
  vehicle_type?: string | null
  vehicle_model?: string | null
  capacity_kg?: number | null
  available_capacity_kg?: number | null
  current_load_kg?: number | null
  latitude?: number | null
  longitude?: number | null
  /** Straight-line distance to the pickup, when both positions are known. */
  distance_km?: number | null
  /** State of the assigned driver's licence: valid, expiring, expired or missing. */
  driver_licence_status?: 'valid' | 'expiring' | 'expired' | 'missing' | null
}
