import { isBiddingOpen, isCargoManifest } from './format'
import type { ShipmentRow } from './types'

/** Mirrors the backend rule in ShipmentService.deleteShipment: once a shipment
 * has moved, deleting it would erase real history. Cancel it instead. */
export const UNDELETABLE_STATUSES = new Set([
  'picked_up', 'in_transit', 'delivered', 'out_for_delivery', 'at_hub', 'partially_delivered', 'on_hold', 'returning', 'returned', 'lost',
])

/** What may be done with a shipment, from its status and where its goods are. Shared by the drawer and the shipment page. */
export function shipmentFlags(s: ShipmentRow) {
  const manifestOnly = isCargoManifest(s)
  const closed = ['delivered', 'cancelled', 'returned', 'lost'].includes(s.status ?? '')
  // Mirrors the backend rule (SHIPMENT_TRANSITIONS): cancelled only before pickup. Everything the
  // goods do after that (pickup, in transit, hubs, delivery, holds, returns) is a custody event or
  // a case action in the Cargo section, not a plain status change.
  const beforePickup = s.status === 'created' || s.status === 'assigned'
  // A vehicle can be (re)assigned while the goods are still with the sender. Goods on a vehicle
  // (a failed delivery included) move by a transfer or a re-attempt; assignDriver refuses them.
  const withSender = !s.current_holder || s.current_holder === 'consignor'
  // A split master holds no goods: its lots are assigned, moved and delivered one by one
  const master = s.is_master === true
  const lot = !!s.parent_shipment_id || !!s.parent_manifest_id
  return {
    manifestOnly,
    closed,
    beforePickup,
    withSender,
    master,
    lot,
    // Cancelling a split master cancels its lots; the backend refuses it once any lot was picked up
    canCancel: beforePickup,
    canAssign: !master && (beforePickup || (s.status === 'exception' && withSender)),
    assignLabel: s.status === 'exception' ? 'Assign again' : s.status === 'assigned' ? 'Change vehicle' : 'Assign vehicle',
    canDelete: !master && !UNDELETABLE_STATUSES.has(s.status ?? ''),
    biddingOpen: isBiddingOpen(s),
  }
}
