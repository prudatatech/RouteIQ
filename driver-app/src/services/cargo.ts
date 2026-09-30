/**
 * Cargo custody for the driver: types for the /cargo endpoints in
 * docs/cargo-plan.md, and readers that turn the server's answers into the
 * shapes the screens use. The readers are forgiving (a missing field is null,
 * never a crash) because the same answers are also read back from the phone's
 * cache when there is no signal.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const CONDITIONS = ['good', 'damaged_packaging', 'damaged_goods', 'wet', 'seal_tampered', 'shortage', 'excess'] as const;
export type ConditionCode = (typeof CONDITIONS)[number];

/**
 * A consignment: a shipment (RTX-…) or a vendor load (CM-…). The server also accepts the
 * tracking ID or load code as a plain string, which is what a parcel scanned offline has.
 */
export type ConsignmentRef = { shipment_id: string } | { manifest_id: string } | string;

export type CustodyKind =
  | 'pickup'
  | 'departed'
  | 'arrived_drop'
  | 'delivery'
  | 'partial_delivery'
  | 'refused'
  | 'undelivered'
  | 'hub_in'
  | 'hub_out'
  | 'return_pickup'
  | 'inspection';

/** Refused and not-delivered reasons: the complete-stop reasons plus `damaged_refused`. */
export type DeliveryReason =
  | 'customer_unavailable'
  | 'address_unreachable'
  | 'customer_refused'
  | 'premises_closed'
  | 'damaged_refused'
  | 'other';

/** Body of POST /cargo/custody, without the files (they are uploaded first). */
export interface CustodyFields {
  kind: CustodyKind;
  pieces?: number;
  weight_kg?: number;
  condition?: ConditionCode;
  /** At pickup: the seal put on. At an inspection: the seal read now; the server compares it. */
  seal_number?: string;
  receiver_name?: string;
  otp?: string;
  lat?: number;
  lng?: number;
  notes?: string;
  pieces_refused?: number;
  pieces_short?: number;
  pieces_damaged?: number;
  reason?: DeliveryReason;
  /** The hub, for hub_in. */
  depot_id?: string;
}

export interface CustodyBody extends CustodyFields {
  ref: ConsignmentRef;
  photo_paths?: string[];
  signature_path?: string;
}

/** A case dispatch opened (EXC-…). */
export interface ExceptionNotice {
  id: string | null;
  code: string;
  type: string | null;
}

/** Where a consignment is, as far as the driver may see (GET /cargo/where/:ref). */
export interface ConsignmentInfo {
  ref: ConsignmentRef | null;
  status: string | null;
  piecesTotal: number | null;
  piecesOnBoard: number | null;
  sealNumber: string | null;
  attempts: number | null;
  maxAttempts: number | null;
  /** Null when the server did not say. */
  otpRequired: boolean | null;
  rto: boolean;
  exceptions: ExceptionNotice[];
}

/** One consignment on the driver's vehicle (GET /cargo/driver/on-board). */
export interface OnBoardItem {
  ref: ConsignmentRef;
  /** Tracking ID or load code, as printed on the parcel. */
  code: string;
  status: string | null;
  pieces: number | null;
  weightKg: number | null;
  condition: ConditionCode | null;
  sealNumber: string | null;
  /** The next stop for this consignment on the driver's route. */
  stopId: string | null;
  stopName: string | null;
  otpRequired: boolean | null;
  exceptions: ExceptionNotice[];
}

export interface TransferItem {
  ref: ConsignmentRef;
  code: string;
  piecesPlanned: number | null;
  piecesOut: number | null;
  piecesIn: number | null;
}

export type TransferStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';

/** A transshipment or move to a hub (cargo_transfers). */
export interface CargoTransfer {
  id: string;
  code: string;
  status: TransferStatus;
  fromVehicleId: string | null;
  toVehicleId: string | null;
  toDepotId: string | null;
  fromPlate: string | null;
  toPlate: string | null;
  depotName: string | null;
  meet: { lat: number; lng: number } | null;
  meetAddress: string | null;
  plannedAt: string | null;
  note: string | null;
  exceptionCode: string | null;
  items: TransferItem[];
}

export interface Hub {
  id: string;
  name: string;
  address: string | null;
}

// ── Readers ────────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

const isCondition = (v: unknown): v is ConditionCode => typeof v === 'string' && (CONDITIONS as readonly string[]).includes(v);

/** `{shipment_id}` / `{manifest_id}`, from a ref object or from the row's own columns. */
export function readRef(raw: any): ConsignmentRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw.ref && typeof raw.ref === 'object' ? raw.ref : raw;
  if (str(source.shipment_id)) return { shipment_id: source.shipment_id };
  if (str(source.manifest_id)) return { manifest_id: source.manifest_id };
  return null;
}

export const refKey = (ref: ConsignmentRef): string =>
  typeof ref === 'string' ? `c:${ref}` : 'shipment_id' in ref ? `s:${ref.shipment_id}` : `m:${ref.manifest_id}`;

/** Vendor-load stops have synthetic ids "<manifest id>_pickup" and "<manifest id>_drop". */
export function manifestRefOfStop(stopId: string | null | undefined): ConsignmentRef | null {
  const match = /^(.+)_(pickup|drop)$/.exec(stopId ?? '');
  return match ? { manifest_id: match[1] } : null;
}

function readExceptions(raw: unknown): ExceptionNotice[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .map((e: any) => ({ id: str(e?.id), code: str(e?.code) ?? '', type: str(e?.type) }))
    .filter((e) => e.code);
}

/** Ids of the cases a custody answer says it opened (`exception_ids`). */
export function exceptionIdsOf(response: any): string[] {
  return Array.isArray(response?.exception_ids) ? response.exception_ids.filter((id: unknown): id is string => typeof id === 'string') : [];
}

export function readConsignmentInfo(raw: any): ConsignmentInfo {
  const pieces = raw?.pieces ?? {};
  return {
    ref: readRef(raw),
    status: str(raw?.status),
    piecesTotal: num(pieces.total ?? raw?.pieces_total),
    piecesOnBoard: num(pieces.on_board),
    sealNumber: str(raw?.seal_number),
    attempts: num(raw?.delivery_attempts),
    maxAttempts: num(raw?.max_delivery_attempts),
    otpRequired: typeof raw?.delivery_otp_required === 'boolean' ? raw.delivery_otp_required : null,
    rto: raw?.rto === true,
    exceptions: readExceptions(raw?.open_exceptions),
  };
}

/**
 * One item of GET /cargo/driver/on-board: `{ ref, code, status, pieces_on_board, pieces_total,
 * weight_kg, seal_number, condition, expected_condition, rto, on_hold_reason, next_stop:
 * { stop_id, route_id, sequence, name, address, lat, lng } | null, open_exceptions }`.
 */
function readOnBoardItem(raw: any): OnBoardItem | null {
  const ref = readRef(raw);
  const code = str(raw?.code);
  if (!ref || !code) return null;
  const condition = raw?.expected_condition ?? raw?.condition;
  return {
    ref,
    code,
    status: str(raw?.status),
    pieces: num(raw?.pieces_on_board ?? raw?.pieces_total),
    weightKg: num(raw?.weight_kg),
    condition: isCondition(condition) ? condition : null,
    sealNumber: str(raw?.seal_number),
    stopId: str(raw?.next_stop?.stop_id),
    stopName: str(raw?.next_stop?.name),
    otpRequired: null,
    exceptions: readExceptions(raw?.open_exceptions),
  };
}

/** GET /cargo/driver/on-board answers `{ vehicle, totals, items }`. */
export function readOnBoard(raw: any): OnBoardItem[] {
  const list = Array.isArray(raw?.items) ? raw.items : [];
  return list.map(readOnBoardItem).filter((i: OnBoardItem | null): i is OnBoardItem => !!i);
}

const TRANSFER_STATUSES: TransferStatus[] = ['planned', 'in_progress', 'completed', 'cancelled'];

export function readTransfer(raw: any): CargoTransfer | null {
  const t = raw;
  if (!str(t?.id)) return null;
  const lat = num(t.meet_lat);
  const lng = num(t.meet_lng);
  // Items: { id, ref, code, status, pieces_planned, pieces_out, pieces_in, condition_in }
  const items: TransferItem[] = (Array.isArray(t.items) ? t.items : [])
    .map((i: any) => {
      const ref = readRef(i);
      if (!ref) return null;
      return {
        ref,
        code: str(i.code) ?? '',
        piecesPlanned: num(i.pieces_planned),
        piecesOut: num(i.pieces_out),
        piecesIn: num(i.pieces_in),
      };
    })
    .filter((i: TransferItem | null): i is TransferItem => !!i);
  return {
    id: t.id,
    code: str(t.code) ?? t.id.slice(0, 8),
    status: TRANSFER_STATUSES.includes(t.status) ? t.status : 'planned',
    fromVehicleId: str(t.from_vehicle_id),
    toVehicleId: str(t.to_vehicle_id),
    toDepotId: str(t.to_depot_id),
    fromPlate: str(t.from_vehicle?.plate_number),
    toPlate: str(t.to_vehicle?.plate_number),
    depotName: str(t.to_depot?.name),
    meet: lat !== null && lng !== null ? { lat, lng } : null,
    meetAddress: str(t.meet_address),
    plannedAt: str(t.planned_at),
    note: str(t.note),
    exceptionCode: str(t.exception?.code),
    items,
  };
}

/** GET /cargo/transfers answers a plain array of transfers (with from_vehicle, to_vehicle, to_depot, exception, items). */
export function readTransfers(raw: any): CargoTransfer[] {
  return (Array.isArray(raw) ? raw : []).map(readTransfer).filter((t: CargoTransfer | null): t is CargoTransfer => !!t);
}

/** GET /depots answers `[{ id, name, latitude, longitude, address }]`. */
export function readHubs(raw: any): Hub[] {
  return (Array.isArray(raw) ? raw : [])
    .map((h: any) => {
      const id = str(h?.id);
      const name = str(h?.name);
      return id && name ? { id, name, address: str(h?.address) } : null;
    })
    .filter((h: Hub | null): h is Hub => !!h);
}

// ── Consignment details kept on the phone ─────────────────────

const INFO_CACHE_KEY = 'cargo_consignment_info_v1';
const INFO_CACHE_MAX = 100;

/** Last known details per parcel code, so the delivery and pickup sheets work without a signal. */
export async function readCachedInfo(code: string): Promise<ConsignmentInfo | null> {
  try {
    const all = JSON.parse((await AsyncStorage.getItem(INFO_CACHE_KEY)) ?? '{}');
    return all[code] ?? null;
  } catch {
    return null;
  }
}

export async function cacheInfo(code: string, info: ConsignmentInfo): Promise<void> {
  try {
    const all = JSON.parse((await AsyncStorage.getItem(INFO_CACHE_KEY)) ?? '{}');
    delete all[code];
    all[code] = info;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - INFO_CACHE_MAX))) delete all[k];
    await AsyncStorage.setItem(INFO_CACHE_KEY, JSON.stringify(all));
  } catch {
    // A cache miss only means the sheet asks the driver for the numbers
  }
}
