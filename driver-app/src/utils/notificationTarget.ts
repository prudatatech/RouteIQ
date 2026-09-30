/**
 * Where a driver notification opens. Pure: the type and the ids it carries
 * (docs/notifications.md, "Drivers") in, a target out; HomeScreen turns the
 * target into a tab, a dialog or a highlighted item.
 *
 *   route_assigned, route_activated   trip            the trip, with the accept prompt if not accepted yet
 *   route_cancelled, shipment_cancelled  cancelled    Home, with a banner saying what happened
 *   cargo_assigned                    load            Home (the new pickup or load), reloaded
 *   cargo_transfer_planned            transfer        that transfer's handover or receive screen
 *                                                     (cancelled: true  ->  Home with a banner)
 *   cargo_transfer_completed, shipment_delivered   home  Home
 *   cargo_exception_opened, other cargo_*          cargo  the cargo check (the goods and their cases)
 *   document_*                        documents       Profile -> Documents, at that document
 *   vehicle_approval                  vehicle         the vehicle gate / Profile
 *   maintenance                       vehicle         Profile
 *   payout_sent                       wallet          Wallet
 *   delivery_rated                    rating          Wallet, with the rating
 *   dispatch_message                  messages        Messages
 *   driver_action_rejected            stop            the affected stop, with the explanation
 *   account_changed                   profile         Profile
 *   anything else                     home            Home
 */
export type DriverTarget =
  | { kind: 'trip'; routeId: string | null }
  | { kind: 'cancelled'; routeId: string | null }
  | { kind: 'load'; requestId: string | null; shipmentId: string | null }
  | { kind: 'transfer'; transferId: string }
  | { kind: 'cargo'; code: string | null; shipmentId: string | null }
  | { kind: 'documents'; docId: string | null; docType: string | null; event: 'verified' | 'rejected' | 'expiring' }
  | { kind: 'vehicle'; vehicleId: string | null; decision: string | null }
  | { kind: 'wallet' }
  | { kind: 'rating'; code: string | null; rating: number | null; comment: string | null }
  | { kind: 'messages'; routeId: string | null }
  | { kind: 'stop'; routeId: string | null; shipmentId: string | null; manifestId: string | null }
  | { kind: 'profile' }
  | { kind: 'home' };

export interface NotificationLike {
  type?: unknown;
  data?: unknown;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Push payloads and rows both carry `data`; a push may hold it as a JSON string. */
export function dataOf(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

export function resolveNotification(n: NotificationLike): DriverTarget {
  const type = typeof n.type === 'string' ? n.type : '';
  const d = dataOf(n.data);

  switch (type) {
    case 'route_assigned':
    case 'route_activated':
      return { kind: 'trip', routeId: str(d.route_id) };
    case 'route_cancelled':
    case 'shipment_cancelled':
      return { kind: 'cancelled', routeId: str(d.route_id) };
    case 'cargo_assigned':
      return { kind: 'load', requestId: str(d.request_id), shipmentId: str(d.shipment_id) };
    case 'cargo_transfer_planned': {
      const id = str(d.transfer_id);
      // A cancelled transfer has nothing to open: tell the driver on Home
      if (!id || d.cancelled === true) return { kind: 'cancelled', routeId: null };
      return { kind: 'transfer', transferId: id };
    }
    case 'cargo_transfer_completed':
    case 'shipment_delivered':
      return { kind: 'home' };
    case 'document_verified':
    case 'document_rejected':
    case 'document_expiring':
      return { kind: 'documents', docId: str(d.doc_id), docType: str(d.doc_type), event: type.slice('document_'.length) as 'verified' | 'rejected' | 'expiring' };
    case 'vehicle_approval':
      return { kind: 'vehicle', vehicleId: str(d.vehicle_id), decision: str(d.decision) };
    case 'maintenance':
      return { kind: 'vehicle', vehicleId: str(d.vehicle_id), decision: null };
    case 'payout_sent':
      return { kind: 'wallet' };
    case 'delivery_rated':
      return { kind: 'rating', code: str(d.code), rating: num(d.rating), comment: str(d.comment) };
    case 'dispatch_message':
      return { kind: 'messages', routeId: str(d.route_id) };
    case 'driver_action_rejected':
      return { kind: 'stop', routeId: str(d.route_id), shipmentId: str(d.shipment_id), manifestId: str(d.manifest_id) };
    case 'account_changed':
      return { kind: 'profile' };
    default:
      break;
  }

  if (str(d.link) === '/wallet') return { kind: 'wallet' };
  if (/message|chat/i.test(type)) return { kind: 'messages', routeId: str(d.route_id) };
  if (type.startsWith('cargo_')) return { kind: 'cargo', code: str(d.code), shipmentId: str(d.shipment_id) };
  return { kind: 'home' };
}

/** The stop a notification is about: a vendor load's stops are `<manifest id>_pickup|_drop`; a shipment's stop is found through what is on board. */
export function stopIdFor(
  target: { shipmentId: string | null; manifestId: string | null },
  stops: ReadonlyArray<{ id: string; status: string }>,
  onBoardStops: ReadonlyArray<{ shipmentId: string | null; stopId: string | null }>,
): string | null {
  if (target.manifestId) {
    const own = stops.filter((s) => s.id.startsWith(`${target.manifestId}_`));
    return (own.find((s) => s.status === 'pending') ?? own[0])?.id ?? null;
  }
  if (target.shipmentId) return onBoardStops.find((i) => i.shipmentId === target.shipmentId)?.stopId ?? null;
  return null;
}
