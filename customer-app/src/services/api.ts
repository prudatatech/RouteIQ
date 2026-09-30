import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';
import { API_V1 } from '../config';
import { secureStorage } from './secureStorage';
import { translateNow } from '../locales';

// Access/refresh tokens live in SecureStore (see secureStorage.ts). Non-sensitive
// profile data (customer name/phone) stays in AsyncStorage. STORAGE_KEYS also
// doubles as the set of legacy AsyncStorage keys migrated out on first init()
// after this change, so existing logged-in users are not logged out.
const STORAGE_KEYS = {
  ACCESS_TOKEN: 'margixindia_customer_access_token',
  REFRESH_TOKEN: 'margixindia_customer_refresh_token',
  CUSTOMER_INFO: 'margixindia_customer_info',
};

/** Emitted when the saved sign-in no longer works, so the app can return to the sign-in screen. */
export const SESSION_EXPIRED_EVENT = 'customer:session-expired';

/** Emitted once a booking is sent, so the planner can clear the trip that was just booked. */
export const BOOKING_CREATED_EVENT = 'customer:booking-created';

/** Emitted once a claim is filed, so the booking screen can show it in its claim list. */
export const CLAIM_CREATED_EVENT = 'customer:claim-created';

/** Emitted after notifications are read, so the tab badge can update. */
export const NOTIFICATIONS_CHANGED_EVENT = 'customer:notifications-changed';

/** A request gives up after this long, so a weak signal never leaves a spinner running for ever. */
const REQUEST_TIMEOUT_MS = 20_000;

const NETWORK_MESSAGE = () => translateNow('err_network');
const SERVER_MESSAGE = () => translateNow('err_server');
const SESSION_MESSAGE = () => translateNow('err_session');

/** The server's own text when it sent one, otherwise a plain sentence. */
function apiMessage(data: any, status: number): string {
  const detail = data?.detail ?? data?.error;
  // Validation errors arrive as a list of { msg } objects.
  const text = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d) => d?.msg).filter(Boolean).join('. ') : '';
  return status >= 500 || !text ? SERVER_MESSAGE() : text;
}

class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  async init() {
    await this.migrateLegacyTokens();
    this.accessToken = await secureStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
    this.refreshToken = await secureStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
  }

  /** Runs init() and reports whether a stored session was found. */
  async hasSession(): Promise<boolean> {
    await this.init();
    return !!this.accessToken;
  }

  /** One-time migration: legacy tokens were stored in plain AsyncStorage. */
  private async migrateLegacyTokens() {
    const [legacyAccess, legacyRefresh] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN),
      AsyncStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN),
    ]);

    if (!legacyAccess && !legacyRefresh) return;

    if (legacyAccess) await secureStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, legacyAccess);
    if (legacyRefresh) await secureStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, legacyRefresh);

    await AsyncStorage.multiRemove([STORAGE_KEYS.ACCESS_TOKEN, STORAGE_KEYS.REFRESH_TOKEN]);
  }

  private async setTokens(accessToken: string, refreshToken: string) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    await secureStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
    await secureStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
  }

  private async clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    await secureStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
    await secureStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
    await AsyncStorage.removeItem(STORAGE_KEYS.CUSTOMER_INFO);
  }

  /** Refreshes the access token using the stored refresh token. Coalesces concurrent callers. */
  private async refreshAccessToken(): Promise<boolean> {
    if (!this.refreshToken) return false;

    if (!this.refreshPromise) {
      this.refreshPromise = (async () => {
        try {
          const response = await fetch(`${API_V1}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: this.refreshToken }),
          });

          if (!response.ok) return false;

          const data = await response.json();
          if (!data.access_token || !data.refresh_token) return false;

          await this.setTokens(data.access_token, data.refresh_token);
          return true;
        } catch {
          return false;
        } finally {
          this.refreshPromise = null;
        }
      })();
    }

    return this.refreshPromise;
  }

  private async request<T = any>(
    method: string,
    path: string,
    body?: any,
    requireAuth = true,
    isRetry = false,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extraHeaders,
    };

    if (requireAuth && this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${API_V1}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch {
      throw new Error(NETWORK_MESSAGE());
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 && requireAuth) {
      if (!isRetry && (await this.refreshAccessToken())) {
        return this.request<T>(method, path, body, requireAuth, true, extraHeaders);
      }
      await this.clearTokens();
      DeviceEventEmitter.emit(SESSION_EXPIRED_EVENT);
      throw new Error(SESSION_MESSAGE());
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(apiMessage(data, response.status));
    }

    return data;
  }

  // ── Auth ───────────────────────────────────────────────────

  async sendOTP(phone: string): Promise<{ status: string; expires_in_seconds: number; phone?: string }> {
    return this.request('POST', '/auth/customer/send-otp', { phone }, false);
  }

  async verifyOTP(phone: string, otp: string): Promise<{
    status: string;
    access_token: string;
    refresh_token: string;
    user_id: string;
    customer: any;
  }> {
    const data = await this.request('POST', '/auth/customer/verify-otp', { phone, otp }, false);

    await this.setTokens(data.access_token, data.refresh_token);
    await AsyncStorage.setItem(STORAGE_KEYS.CUSTOMER_INFO, JSON.stringify(data.customer));

    return data;
  }

  async logout(): Promise<void> {
    await this.clearTokens();
  }

  // ── Notifications ──────────────────────────────────────────

  async getNotifications(params: { limit?: number; offset?: number } = {}): Promise<{
    notifications: NotificationItem[];
    total: number;
    unread_count: number;
    limit: number;
    offset: number;
  }> {
    const query = new URLSearchParams();
    if (params.limit != null) query.set('limit', String(params.limit));
    if (params.offset != null) query.set('offset', String(params.offset));
    const qs = query.toString();
    return this.request('GET', `/notifications${qs ? `?${qs}` : ''}`);
  }

  async markNotificationRead(id: string): Promise<NotificationItem> {
    return this.request('POST', `/notifications/${id}/read`);
  }

  async markAllNotificationsRead(): Promise<{ success: boolean }> {
    return this.request('POST', '/notifications/read-all');
  }

  // ── Quote ──────────────────────────────────────────────────

  /**
   * Price for a shipment. The pricing engine's contract is
   * {low, suggested, high, factors[]}; today the backend answers from the
   * per-km rate, and this function is the only place that needs to change
   * if the endpoint moves to /pricing/quote.
   */
  async getQuote(input: QuoteRequest): Promise<Quote> {
    return this.request('POST', '/customer/quote', input);
  }

  // ── Bookings ───────────────────────────────────────────────

  /** The price is worked out again on the server; the app never sends one. */
  async createBooking(input: BookingRequest): Promise<Booking> {
    return this.request('POST', '/customer/bookings', input);
  }

  async listBookings(): Promise<Booking[]> {
    return this.request('GET', '/customer/bookings');
  }

  async getBooking(id: string): Promise<BookingDetail> {
    return this.request('GET', `/customer/bookings/${id}`);
  }

  async cancelBooking(id: string, reason?: string): Promise<Booking> {
    return this.request('POST', `/customer/bookings/${id}/cancel`, reason ? { reason } : {});
  }

  // ── Cargo: where it is, proof of delivery, receipt and claims ──

  /**
   * Where the goods are, their custody timeline, the POD, open notices, claims and the rating
   * (docs/cargo-plan.md, "Responses"). Answers 409 while the booking has no shipment.
   */
  async getBookingCargo(bookingId: string): Promise<BookingCargo> {
    return normaliseBookingCargo(await this.request('GET', `/customer/bookings/${bookingId}/cargo`));
  }

  /** The same key on a resend makes the server apply the confirmation once. A delivery is rated once (409 after that). */
  async confirmReceipt(bookingId: string, input: ConfirmReceiptInput, idempotencyKey?: string): Promise<Record<string, unknown>> {
    return this.request('POST', `/customer/bookings/${bookingId}/confirm-receipt`, input, true, false, idempotencyHeader(idempotencyKey));
  }

  /** Files a claim. Pass the same key when retrying after a lost reply, so only one claim is created. */
  async createClaim(input: ClaimInput, idempotencyKey?: string): Promise<Claim> {
    const data = await this.request('POST', '/cargo/claims', input, true, false, idempotencyHeader(idempotencyKey));
    const claim = normaliseClaim(data);
    if (!claim) throw new Error(SERVER_MESSAGE());
    return claim;
  }

  /** A signed upload for one claim photo; the server adds the path to the claim's documents when it issues it. */
  async getClaimUploadUrl(claimId: string, file: { content_type: string; size: number; file_name: string }): Promise<UploadTarget> {
    const data = await this.request('POST', `/cargo/claims/${claimId}/documents-upload-url`, file);
    if (typeof data?.signed_url !== 'string') throw new Error(SERVER_MESSAGE());
    return { path: String(data.path ?? ''), signed_url: data.signed_url, token: data.token ?? null };
  }

  /**
   * The customer's own claims for one consignment or lot (its tracking ID). The server answers a
   * plain array. The cargo view's `claims` holds only the booking's own, so a lot's come from here.
   */
  async listClaims(ref: string): Promise<Claim[]> {
    const data = await this.request('GET', `/cargo/claims?ref=${encodeURIComponent(ref)}`);
    return asArray(data).map(normaliseClaim).filter((c): c is Claim => c !== null);
  }
}

const idempotencyHeader = (key?: string): Record<string, string> | undefined => (key ? { 'Idempotency-Key': key } : undefined);

/** A key the server accepts (8 to 100 letters, digits, dashes), made once per form so a resend matches. */
export function newIdempotencyKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** A multi-drop booking has 2 to this many drops (the server's limit). */
export const MAX_DROPS = 20;

/**
 * One drop of a multi-drop booking (the server's DropInputSchema): the backend makes one lot per
 * drop, with its own consignee and pieces. Weights, when sent, are sent for every drop and add up
 * to the booking's weight_kg (within 0.5 kg).
 */
export interface BookingDrop {
  name?: string | null;
  address: string;
  lat: number;
  lng: number;
  consignee_name: string;
  /** 6 to 20 characters when given. */
  consignee_phone?: string | null;
  consignee_gstin?: string | null;
  /** Whole pieces, at least 1. */
  pieces: number;
  weight_kg?: number | null;
  declared_value?: number | null;
  eway_bill_ref?: string | null;
}

/** POST /customer/quote. The price is for one drop: with several, the farthest (the server takes no drops here). */
export interface QuoteRequest {
  pickup_lat: number;
  pickup_lng: number;
  drop_lat: number;
  drop_lng: number;
  weight_kg: number;
  vehicle_type?: string | null;
  load_type: 'full' | 'part';
  /** Pickup day, YYYY-MM-DD (India). */
  date: string;
}

export interface BookingRequest extends QuoteRequest {
  pickup_name: string;
  pickup_address: string;
  /** With several drops: the farthest, the one the price is quoted to. */
  drop_name: string;
  drop_address: string;
  /** Only for a booking to more than one drop (2 to MAX_DROPS); a single drop sends none. */
  drops?: BookingDrop[];
}

/** Shipment statuses. An unknown future value still type-checks as a string, so a new status never breaks the app. */
export type ShipmentStatus =
  | 'created'
  | 'assigned'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'at_hub'
  | 'on_hold'
  | 'exception'
  | 'partially_delivered'
  | 'delivered'
  | 'returning'
  | 'returned'
  | 'lost'
  | 'cancelled'
  | (string & {});

export type BookingStatus = 'requested' | 'confirmed' | 'assigned' | 'in_transit' | 'delivered' | 'cancelled';

export interface Booking {
  id: string;
  pickup_name: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  drop_name: string;
  drop_address: string;
  drop_lat: number;
  drop_lng: number;
  weight_kg: number;
  load_type: 'full' | 'part';
  vehicle_type: string | null;
  /** YYYY-MM-DD */
  pickup_date: string;
  quoted_price: number | null;
  status: BookingStatus;
  /** Status of the linked shipment, more detailed than the booking's. `exception` means a delivery attempt failed. */
  shipment_status?: ShipmentStatus | null;
  tracking_id: string | null;
  cancel_reason: string | null;
  created_at: string;
}

/** What the public tracking endpoint returns for a shipment (no vendor or driver details). */
export interface Tracking {
  status: string;
  eta_minutes: number | null;
  vehicle: { plate_number: string | null; type: string | null; lat: number | null; lng: number | null } | null;
  destination: { name: string | null; address: string | null; lat: number | null; lng: number | null } | null;
  origin_lat: number | null;
  origin_lng: number | null;
  history: { status: string; at: string }[];
}

export interface BookingDetail {
  booking: Booking;
  tracking: Tracking | null;
}

export interface Quote {
  /** False when no price can be given yet. */
  available: boolean;
  low: number | null;
  suggested: number | null;
  high: number | null;
  distance_km: number | null;
  /** `code` is a stable id the app translates; `label` is the server's English fallback. */
  factors: { code?: string; label: string; detail: string }[];
  message?: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  type: string;
  is_read: boolean;
  data: Record<string, any> | null;
  created_at: string;
}

// ── Cargo types and parsers ─────────────────────────────────

export type CustodyKind =
  | 'booked'
  | 'accepted'
  | 'arrived_pickup'
  | 'pickup'
  | 'departed'
  | 'arrived_drop'
  | 'delivery'
  | 'partial_delivery'
  | 'refused'
  | 'undelivered'
  | 'handover_out'
  | 'handover_in'
  | 'hub_in'
  | 'hub_out'
  | 'return_pickup'
  | 'return_delivery'
  | 'inspection'
  | 'hold'
  | 'release_hold'
  | 'lost'
  | 'split'
  | 'merge'
  | (string & {});

export type ConditionCode = 'good' | 'damaged_packaging' | 'damaged_goods' | 'wet' | 'seal_tampered' | 'shortage' | 'excess' | (string & {});

/**
 * One recorded handover or check of the goods (the customer's redacted view: no notes, case
 * ids, transfer ids or people). `summary` is the server's plain English line.
 */
export interface CustodyEvent {
  id: string;
  kind: CustodyKind;
  summary: string | null;
  recorded_at: string | null;
  pieces: number | null;
  condition: ConditionCode | null;
  from_holder: string | null;
  to_holder: string | null;
  depot_name: string | null;
  receiver_name: string | null;
  photo_urls: string[];
  signature_url: string | null;
  /** On a split consignment's merged timeline: the lot the event belongs to (`{ label: 'B', code: 'RTX-ABC123-B' }`). */
  lot: { label: string | null; code: string } | null;
}

export interface CargoPieces {
  total: number | null;
  delivered: number | null;
  damaged: number | null;
  short: number | null;
  returned: number | null;
  on_board: number | null;
}

/** Where the goods are now. */
export interface CargoWhere {
  shipment_id: string | null;
  status: ShipmentStatus | null;
  current_holder: string | null;
  vehicle: { plate_number: string | null; lat: number | null; lng: number | null; last_seen_at: string | null } | null;
  depot: { id: string | null; name: string | null; address: string | null } | null;
  pieces: CargoPieces;
  seal_number: string | null;
  delivery_attempts: number | null;
  max_delivery_attempts: number | null;
  delivery_otp_required: boolean;
  rto: boolean;
  /** Split into lots: the status, holder and pieces are rolled up from the lots. */
  is_master: boolean;
  /** For a lot: its label (`B`, `A2`) and its master's tracking ID. */
  lot_label: string | null;
  master_code: string | null;
  /** A master's pieces added up across its lots. */
  totals: LotTotals | null;
}

export interface ProofOfDelivery {
  photo_url: string | null;
  signature_url: string | null;
  /** The server's `received_by`. */
  receiver_name: string | null;
  /** Not in the POD itself: the time of the delivery event on the timeline. */
  delivered_at: string | null;
}

/** An open problem, told in plain words by the server, with the new ETA when there is one. */
export interface CargoNotice {
  id: string | null;
  type: string;
  title: string | null;
  message: string;
  revised_eta: string | null;
}

export type ClaimType = 'damage' | 'shortage' | 'loss' | 'theft' | 'delay';
export type ClaimStatus = 'draft' | 'filed' | 'surveyed' | 'approved' | 'rejected' | 'settled' | 'withdrawn' | (string & {});

export interface Claim {
  id: string;
  code: string | null;
  claim_type: string | null;
  status: ClaimStatus;
  claimed_amount: number | null;
  approved_amount: number | null;
  settled_amount: number | null;
  created_at: string | null;
  updated_at: string | null;
  settled_at: string | null;
  /** The consignment (or lot) the claim is on. */
  shipment_id: string | null;
  /** Its RTX- code; a lot's ends in the lot label (`RTX-ABC123-B`). */
  consignment_code: string | null;
}

/**
 * One lot of a booking split across drops, trucks or hubs (`lots[]` of the cargo view; cancelled
 * lots are left out by the server).
 */
export interface CargoLot {
  /** The lot's own shipment (`ref.shipment_id`): claims on the lot name it. */
  shipment_id: string | null;
  /** The lot's tracking ID, e.g. `RTX-ABC123-B`. */
  code: string;
  /** A letter and a number: `A`, `B`, `A1`, `A2`. */
  label: string | null;
  status: ShipmentStatus | null;
  current_holder: string | null;
  pieces: CargoPieces;
  consignee_name: string | null;
  drop: { name: string | null; address: string | null } | null;
  vehicle_plate: string | null;
  depot_name: string | null;
  /** The server's plain sentence, e.g. "Lot B (25 pieces): delivered to Sharma Traders, Boring Road, Patna". */
  text: string | null;
  /** The lot's own proof of delivery (the master has none once split). */
  pod: ProofOfDelivery | null;
  /** The lot's last delivery, return or loss on the booking's timeline: its claim window starts there. */
  delivered_at: string | null;
  /** The lot's last delivery event, for its photo and signature when there is no POD record. */
  delivery: CustodyEvent | null;
}

/** A master's `where.totals`: its own pieces and every lot's added up. */
export interface LotTotals {
  pieces_total: number | null;
  delivered: number;
  lots: number;
  /** In English: "60 of 100 delivered · 25 at Patna hub · 15 on HR55AB1234". */
  progress_text: string | null;
}

export interface BookingCargo {
  where: CargoWhere | null;
  /** Oldest first. */
  timeline: CustodyEvent[];
  pod: ProofOfDelivery | null;
  exceptions: CargoNotice[];
  claims: Claim[];
  /** The server gives no send time: the app looks for the `cargo_delivery_otp` notification. */
  delivery_otp: { required: boolean; sent_at: string | null } | null;
  /** Set once the delivery was rated (`rating: { rating }`); it can be rated only once. */
  receipt: { rating: number | null; confirmed_at: string | null } | null;
  /** The lots, when the booking was split (a master); empty otherwise. */
  lots: CargoLot[];
}

export interface ConfirmReceiptInput {
  rating: number;
  comment?: string;
  /** A problem with the delivery; the server opens a claim of this type. */
  issue?: { type: ClaimType; description: string; claimed_amount?: number };
}

export interface ClaimInput {
  ref: { shipment_id: string };
  claim_type: ClaimType;
  /** May be left for later. */
  claimed_amount?: number | null;
  notes: string;
}

export interface UploadTarget {
  path: string;
  signed_url: string;
  token: string | null;
}

const asObject = (v: unknown): Record<string, any> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : null);
const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const asString = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : typeof v === 'number' ? String(v) : null);
/** Numbers may arrive as strings (Postgres numeric). */
const asNumber = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

function normaliseEvent(raw: unknown, index: number): CustodyEvent | null {
  const e = asObject(raw);
  const kind = asString(e?.kind);
  if (!e || !kind) return null;
  const lot = asObject(e.lot);
  return {
    id: asString(e.id) ?? `${kind}-${index}`,
    kind,
    summary: asString(e.summary),
    recorded_at: asString(e.recorded_at),
    pieces: asNumber(e.pieces),
    condition: asString(e.condition),
    from_holder: asString(e.from_holder),
    to_holder: asString(e.to_holder),
    depot_name: asString(asObject(e.to_depot)?.name) ?? asString(asObject(e.from_depot)?.name),
    receiver_name: asString(e.receiver_name),
    photo_urls: asArray(e.photo_urls)
      .map(asString)
      .filter((u): u is string => u !== null),
    signature_url: asString(e.signature_url),
    lot: lot && asString(lot.code) ? { label: asString(lot.label), code: String(lot.code) } : null,
  };
}

function normaliseWhere(raw: unknown): CargoWhere | null {
  const w = asObject(raw);
  if (!w) return null;
  const ref = asObject(w.ref);
  const vehicle = asObject(w.vehicle);
  const depot = asObject(w.depot);
  const pieces = asObject(w.pieces) ?? {};
  return {
    shipment_id: asString(ref?.shipment_id) ?? asString(w.shipment_id),
    status: asString(w.status),
    current_holder: asString(w.current_holder),
    vehicle: vehicle
      ? {
          plate_number: asString(vehicle.plate_number),
          lat: asNumber(vehicle.lat),
          lng: asNumber(vehicle.lng),
          last_seen_at: asString(vehicle.last_seen_at),
        }
      : null,
    depot: depot ? { id: asString(depot.id), name: asString(depot.name), address: asString(depot.address) } : null,
    pieces: {
      total: asNumber(pieces.total),
      delivered: asNumber(pieces.delivered),
      damaged: asNumber(pieces.damaged),
      short: asNumber(pieces.short),
      returned: asNumber(pieces.returned),
      on_board: asNumber(pieces.on_board),
    },
    seal_number: asString(w.seal_number),
    delivery_attempts: asNumber(w.delivery_attempts),
    max_delivery_attempts: asNumber(w.max_delivery_attempts),
    delivery_otp_required: w.delivery_otp_required === true,
    rto: w.rto === true,
    is_master: w.is_master === true,
    lot_label: asString(w.lot_label),
    master_code: asString(asObject(w.master)?.code),
    totals: normaliseTotals(w.totals),
  };
}

function normaliseTotals(raw: unknown): LotTotals | null {
  const t = asObject(raw);
  if (!t) return null;
  return {
    pieces_total: asNumber(t.pieces_total),
    delivered: asNumber(t.delivered) ?? 0,
    lots: asNumber(t.lots) ?? 0,
    progress_text: asString(t.progress_text),
  };
}

function normaliseClaim(raw: unknown): Claim | null {
  const c = asObject(raw);
  const id = asString(c?.id);
  if (!c || !id) return null;
  return {
    id,
    code: asString(c.code),
    claim_type: asString(c.claim_type),
    status: asString(c.status) ?? 'filed',
    claimed_amount: asNumber(c.claimed_amount),
    approved_amount: asNumber(c.approved_amount),
    settled_amount: asNumber(c.settled_amount),
    created_at: asString(c.created_at),
    updated_at: asString(c.updated_at),
    settled_at: asString(c.settled_at),
    shipment_id: asString(c.shipment_id),
    consignment_code: asString(c.consignment_code),
  };
}

/** A proof of delivery `{ received_by, photo_url, signature_url }`, or null when it has nothing. */
function normalisePod(raw: unknown, deliveredAt: string | null): ProofOfDelivery | null {
  const pod = asObject(raw);
  if (!pod) return null;
  return {
    photo_url: asString(pod.photo_url),
    signature_url: asString(pod.signature_url),
    receiver_name: asString(pod.received_by) ?? asString(pod.receiver_name),
    delivered_at: asString(pod.delivered_at) ?? deliveredAt,
  };
}

/**
 * One lot of the cargo view: `{ ref, code, label, status, current_holder, pieces, consignee: { name }
 * | null, drop, vehicle, depot, text, pod }`. Its delivery time and event come from the booking's
 * timeline, where each lot's events carry `lot.code`.
 */
function normaliseLot(raw: unknown, timeline: CustodyEvent[]): CargoLot | null {
  const l = asObject(raw);
  const code = asString(l?.code);
  if (!l || !code) return null;
  const pieces = asObject(l.pieces) ?? {};
  const drop = asObject(l.drop);
  const own = timeline.filter((e) => e.lot?.code === code);
  const delivery = [...own].reverse().find((e) => e.kind === 'delivery' || e.kind === 'partial_delivery') ?? null;
  // The server's claim window starts at the last delivery, return or loss
  const settled = [...own].reverse().find((e) => ['delivery', 'partial_delivery', 'return_delivery', 'lost'].includes(e.kind)) ?? null;
  return {
    shipment_id: asString(asObject(l.ref)?.shipment_id),
    code,
    label: asString(l.label),
    status: asString(l.status),
    current_holder: asString(l.current_holder),
    pieces: {
      total: asNumber(pieces.total),
      delivered: asNumber(pieces.delivered),
      damaged: asNumber(pieces.damaged),
      short: asNumber(pieces.short),
      returned: asNumber(pieces.returned),
      on_board: asNumber(pieces.on_board),
    },
    consignee_name: asString(asObject(l.consignee)?.name),
    drop: drop ? { name: asString(drop.name), address: asString(drop.address) } : null,
    vehicle_plate: asString(asObject(l.vehicle)?.plate_number),
    depot_name: asString(asObject(l.depot)?.name),
    text: asString(l.text),
    pod: normalisePod(l.pod, delivery?.recorded_at ?? null),
    delivered_at: settled?.recorded_at ?? null,
    delivery,
  };
}

function normaliseNotice(raw: unknown): CargoNotice | null {
  const n = asObject(raw);
  const message = asString(n?.message);
  if (!n || !message) return null;
  return {
    id: asString(n.id),
    type: asString(n.type) ?? 'other',
    title: asString(n.title),
    message,
    revised_eta: asString(n.revised_eta),
  };
}

const timeOf = (e: CustodyEvent) => (e.recorded_at ? new Date(e.recorded_at).getTime() || 0 : 0);

/**
 * GET /customer/bookings/:id/cargo: `{ booking_id, shipment_id, tracking_id, where, timeline,
 * pod: { received_by, photo_url, signature_url, signature_data } | null, exceptions, claims,
 * rating: { rating } | null, lots }`. A master's own `pod` is null (each lot has its own), and its
 * `claims` are the booking's own: a lot's claims are listed by the lot's tracking ID.
 */
export function normaliseBookingCargo(raw: unknown): BookingCargo {
  const d = asObject(raw) ?? {};
  const timeline = asArray(d.timeline)
    .map(normaliseEvent)
    .filter((e): e is CustodyEvent => e !== null)
    // Sorted here (stable, so equal times keep the server's order) so the screen never depends on it.
    .sort((a, b) => timeOf(a) - timeOf(b));
  const rating = asNumber(asObject(d.rating)?.rating);
  const where = normaliseWhere(d.where);
  if (where && !where.shipment_id) where.shipment_id = asString(d.shipment_id);
  const delivery = [...timeline].reverse().find((e) => e.kind === 'delivery' || e.kind === 'partial_delivery');
  // In the server's lot order (A, B, then A1, A2 for a lot split again)
  const lots = asArray(d.lots)
    .map((l) => normaliseLot(l, timeline))
    .filter((l): l is CargoLot => l !== null);
  return {
    where,
    timeline,
    pod: normalisePod(d.pod, delivery?.recorded_at ?? null),
    exceptions: asArray(d.exceptions)
      .map(normaliseNotice)
      .filter((n): n is CargoNotice => n !== null),
    claims: asArray(d.claims)
      .map(normaliseClaim)
      .filter((c): c is Claim => c !== null),
    delivery_otp: where?.delivery_otp_required ? { required: true, sent_at: null } : null,
    receipt: rating != null ? { rating, confirmed_at: null } : null,
    lots,
  };
}

export const api = new ApiClient();
export { STORAGE_KEYS };
