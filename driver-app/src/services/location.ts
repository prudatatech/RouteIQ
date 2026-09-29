/**
 * margixindia Driver App — Live GPS Location Service
 *
 * 1. Phone GPS at navigation accuracy, in the foreground and (through
 *    expo-task-manager) in the background
 * 2. Positions go to the backend (POST /telemetry/driver-ping), never straight
 *    to the database, so its rules run on every one: odometer, geofence
 *    arrival, overspeed / low-fuel / GPS-lost alerts, the live broadcast
 * 3. The vehicle's status is the backend's to decide (from its route or
 *    load); the app never writes it
 * 4. An offline queue holds positions the server could not take and replays
 *    them in batches
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, getCurrentSession } from './supabase';
import { api, ApiError } from './api';
import { DEFAULT_PING_INTERVAL_MS, MIN_PING_INTERVAL_MS, MAX_PING_INTERVAL_MS } from '../config';
import { colors } from '../theme';
import { translateNow } from '../locales';

const QUEUE_KEY = 'margixindia_ping_queue';
const VEHICLE_ID_KEY = 'margixindia_vehicle_id';
const DRIVER_ID_KEY = 'margixindia_driver_id';
/** Points sent per request; the backend takes up to 200. */
const PING_BATCH_SIZE = 100;
export const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';

interface LocationPing {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  accuracy: number;
  timestamp: string;
}

export interface BackgroundError {
  /** epoch ms */
  at: number;
  message: string;
}

/** Repeated failures before a background error is surfaced to the UI. */
const BACKGROUND_ERROR_THRESHOLD = 3;

class LocationService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private watchSubscription: Location.LocationSubscription | null = null;
  private currentInterval: number = DEFAULT_PING_INTERVAL_MS;
  private isRunning = false;
  private vehicleId: string | null = null;
  private driverId: string | null = null;
  public onGeofenceAlert: ((alert: any) => void) | null = null;
  public onPendingCommand: ((commands: any[]) => void) | null = null;
  public onLocationUpdate: ((loc: LocationPing, speedMps: number | null) => void) | null = null;
  /** Fired when a background error is recorded or cleared (null = cleared). */
  public onBackgroundError: ((err: BackgroundError | null) => void) | null = null;
  private lastLat: number = 0;
  private lastLng: number = 0;
  private consecutiveErrors: number = 0;
  private lastGpsOffNotificationTime = 0;
  private consecutiveSendFailures = 0;
  private lastBackgroundError: BackgroundError | null = null;

  /**
   * Non-blocking: records a background failure (a position that could not be
   * sent) without ever throwing or interrupting tracking. Only surfaces to the
   * UI once the same failure repeats BACKGROUND_ERROR_THRESHOLD times in a
   * row, so a single blip stays quiet.
   */
  private recordBackgroundFailure(message: string) {
    if (++this.consecutiveSendFailures < BACKGROUND_ERROR_THRESHOLD) return;
    this.lastBackgroundError = { at: Date.now(), message };
    this.onBackgroundError?.(this.lastBackgroundError);
  }

  private clearBackgroundFailure() {
    this.consecutiveSendFailures = 0;
    if (this.lastBackgroundError) {
      this.lastBackgroundError = null;
      this.onBackgroundError?.(null);
    }
  }

  /** Last recorded background error, if any (also available via onBackgroundError). */
  getLastBackgroundError(): BackgroundError | null {
    return this.lastBackgroundError;
  }

  /** Dismiss the current background error so the UI can retry quietly. */
  clearLastBackgroundError() {
    this.consecutiveSendFailures = 0;
    this.lastBackgroundError = null;
    this.onBackgroundError?.(null);
  }

  /**
   * Set the vehicle and driver IDs for this tracking session.
   * Call this after login or when vehicle is assigned.
   */
  async setIdentity(vehicleId: string, driverId: string) {
    // Positions queued by another driver on this phone must not be reported as this driver's
    const previousDriver = await AsyncStorage.getItem(DRIVER_ID_KEY);
    if (previousDriver && previousDriver !== driverId) await this.clearQueue();
    this.vehicleId = vehicleId;
    this.driverId = driverId;
    await AsyncStorage.setItem(VEHICLE_ID_KEY, vehicleId);
    await AsyncStorage.setItem(DRIVER_ID_KEY, driverId);
  }

  /**
   * Load saved identity from storage
   */
  async loadIdentity(): Promise<boolean> {
    this.vehicleId = await AsyncStorage.getItem(VEHICLE_ID_KEY);
    this.driverId = await AsyncStorage.getItem(DRIVER_ID_KEY);
    return !!(this.vehicleId && this.driverId);
  }

  /**
   * Auto-discover vehicle ID from driver's assigned vehicle
   */
  async autoDiscoverVehicle(driverId: string): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id')
        .eq('driver_id', driverId)
        .limit(1)
        .single();

      if (data && !error) {
        await this.setIdentity(data.id, driverId);
        return data.id;
      }
    } catch (e) {
      console.warn('Auto-discover vehicle failed:', e);
    }
    return null;
  }

  /**
   * Request permissions and start Ola/Uber-style GPS tracking.
   */
  async start(
    onGeofence?: (alert: any) => void,
    onCommand?: (commands: any[]) => void,
    /** `speedMps` is the device's own speed reading in metres per second, or null when it has none. */
    onLocationUpdate?: (loc: LocationPing, speedMps: number | null) => void,
    onBackgroundError?: (err: BackgroundError | null) => void,
  ): Promise<{ success: boolean; error?: string }> {
    if (this.isRunning) return { success: true };

    // Load identity if not set
    if (!this.vehicleId) {
      const loaded = await this.loadIdentity();
      if (!loaded) {
        return { success: false, error: 'No vehicle assigned. Please login first.' };
      }
    }

    // Request foreground permission
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') {
      return { success: false, error: 'Foreground location permission denied' };
    }

    // Request background permission
    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    if (bgStatus !== 'granted') {
      console.warn('Background location denied — tracking will stop when app is minimized');
    }

    this.onGeofenceAlert = onGeofence || null;
    this.onPendingCommand = onCommand || null;
    this.onLocationUpdate = onLocationUpdate || null;
    this.onBackgroundError = onBackgroundError || null;
    this.isRunning = true;
    this.consecutiveErrors = 0;
    this.consecutiveSendFailures = 0;
    this.lastBackgroundError = null;

    // Initial precise ping
    await this.collectAndSend();

    // Start continuous watching (Ola/Uber style - reacts to movement)
    this.startWatching();

    // Also start interval as backup (ensures periodic updates even if stationary)
    this.startInterval();

    return { success: true };
  }

  /**
   * Stop tracking.
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.watchSubscription) {
      this.watchSubscription.remove();
      this.watchSubscription = null;
    }
    Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(e => console.warn('Failed to stop bg location', e));
    this.isRunning = false;
    Notifications.cancelScheduledNotificationAsync('gps-dead-man-switch').catch(() => { });
  }

  /**
   * Start continuous GPS watching (like Ola/Uber).
   * This reacts to actual movement rather than just polling.
   */
  private async startWatching() {
    try {
      this.watchSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 5,   // Update every 5 meters of movement
          timeInterval: 3000,    // Or every 3 seconds minimum
        },
        async (location) => {
          await this.processLocationUpdate(location);
        }
      );

      // Also start background updates
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: 5,
        timeInterval: 3000,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: "MargixIndia tracking",
          notificationBody: "Location tracking is active for your route.",
          notificationColor: colors.accent,
        }
      });
    } catch (e) {
      console.warn('watchPositionAsync or startLocationUpdatesAsync failed, falling back to polling:', e);
    }
  }

  public async processLocationUpdate(location: Location.LocationObject) {
    const ping: LocationPing = {
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      speed: Math.max(0, location.coords.speed || 0),
      heading: location.coords.heading || 0,
      accuracy: location.coords.accuracy || 0,
      timestamp: new Date(location.timestamp).toISOString(),
    };

    if (this.onLocationUpdate) {
      // The device reports no speed (null, or a negative number) until it has one; that is not the same as standing still
      const raw = location.coords.speed;
      this.onLocationUpdate(ping, typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null);
    }

    // Only send if position actually changed (>2m)
    const dLat = Math.abs(ping.lat - this.lastLat);
    const dLng = Math.abs(ping.lng - this.lastLng);
    if (dLat > 0.00002 || dLng > 0.00002 || this.lastLat === 0) {
      await this.sendPings([ping]);
      this.lastLat = ping.lat;
      this.lastLng = ping.lng;
    }
  }

  /**
   * Collect GPS and send it (with anything queued while offline) to the backend.
   */
  private async collectAndSend() {
    try {
      const gpsEnabled = await Location.hasServicesEnabledAsync();
      if (!gpsEnabled) {
        // Trigger local push notification to alert driver, throttled to once per 60s
        const now = Date.now();
        if (now - this.lastGpsOffNotificationTime > 60000) {
          this.lastGpsOffNotificationTime = now;
          // A normal, single notification: the looping siren is kept for new
          // assignments and dispatch calls only.
          await Notifications.scheduleNotificationAsync({
            content: {
              title: translateNow('notify_gps_off_title'),
              body: translateNow('notify_gps_off_body'),
              sound: 'default',
              autoDismiss: false,
            },
            trigger: { seconds: 1, channelId: 'default' } as any,
          });
        }

        // Nothing is sent while GPS is off: the missing heartbeat is what raises the GPS-lost alert.
        return; // Skip getting position if GPS is disabled at OS level
      }

      // Get current position with maximum navigation-grade accuracy
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });

      const ping: LocationPing = {
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        speed: Math.max(0, location.coords.speed || 0),
        heading: location.coords.heading || 0,
        accuracy: location.coords.accuracy || 0,
        timestamp: new Date(location.timestamp).toISOString(),
      };

      // Positions queued while offline go first, in one batch with the current one. Clear before
      // replaying so a batch that fails again is re-queued rather than dropped.
      const queue = await this.getQueue();
      if (queue.length > 0) await this.clearQueue();
      await this.sendPings([...queue, ping]);
      this.lastLat = ping.lat;
      this.lastLng = ping.lng;
      this.consecutiveErrors = 0;

    } catch (e) {
      console.warn('Location collection failed:', e);
      this.consecutiveErrors++;
    }
  }

  /**
   * Send positions to the backend in batches. The backend records them, runs its
   * rules and answers with what the app needs next (a geofence arrival, commands,
   * how often to report). Positions it could not take (no signal, server trouble)
   * are queued and replayed; ones it refuses for good are dropped so they do not
   * come back for ever.
   */
  private async sendPings(pings: LocationPing[]) {
    if (!this.vehicleId || pings.length === 0) return;

    // Without a session the server would refuse them; keep them for later.
    if (!(await getCurrentSession())) {
      await this.enqueue(pings);
      return;
    }

    for (let i = 0; i < pings.length; i += PING_BATCH_SIZE) {
      const batch = pings.slice(i, i + PING_BATCH_SIZE);
      try {
        const answer = await api.sendPing(batch);
        this.clearBackgroundFailure();
        this.handlePingAnswer(answer);
      } catch (e: any) {
        const refusedForGood = e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
        if (refusedForGood) {
          console.warn('Server refused a location batch, dropping it:', e.message);
          continue;
        }
        // Never blocks tracking; only surfaced to the UI once it repeats (see recordBackgroundFailure).
        console.warn('Server unreachable, queuing pings:', e?.message);
        await this.enqueue(pings.slice(i));
        this.recordBackgroundFailure(e?.message || 'Could not reach the server');
        return;
      }
    }
  }

  private handlePingAnswer(answer: { geofence_alert?: any; pending_commands?: any[]; next_ping_interval_ms?: number }) {
    if (answer.geofence_alert) this.onGeofenceAlert?.(answer.geofence_alert);
    if (answer.pending_commands && answer.pending_commands.length > 0) this.onPendingCommand?.(answer.pending_commands);

    // The server sets how often to report: often when moving fast, rarely when stopped
    const wanted = Number(answer.next_ping_interval_ms);
    if (Number.isFinite(wanted) && wanted > 0) {
      const interval = Math.min(Math.max(wanted, MIN_PING_INTERVAL_MS), MAX_PING_INTERVAL_MS);
      if (interval !== this.currentInterval) {
        this.currentInterval = interval;
        if (this.isRunning) this.restartInterval();
      }
    }
  }

  // ── Queue Management (offline support) ─────────────────────

  private async getQueue(): Promise<LocationPing[]> {
    try {
      const data = await AsyncStorage.getItem(QUEUE_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private async saveQueue(queue: LocationPing[]) {
    const capped = queue.slice(-500);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(capped));
  }

  private async enqueue(pings: LocationPing[]) {
    const queue = await this.getQueue();
    queue.push(...pings);
    await this.saveQueue(queue);
  }

  private async clearQueue() {
    await AsyncStorage.removeItem(QUEUE_KEY);
  }

  // ── Interval Management ────────────────────────────────────

  private startInterval() {
    this.intervalId = setInterval(() => this.collectAndSend(), this.currentInterval);
  }

  private restartInterval() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.startInterval();
  }

  get hasIdentity() {
    return !!this.vehicleId;
  }

  get isTracking() {
    return this.isRunning;
  }

  get pingIntervalMs() {
    return this.currentInterval;
  }
}

export const locationService = new LocationService();

// Register background task
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('Background location task error:', error);
    return;
  }
  if (data) {
    const { locations } = data as { locations: Location.LocationObject[] };
    if (locations && locations.length > 0) {
      // In a headless run (app killed) the service starts empty: restore the
      // vehicle identity; the Supabase session is restored from secure storage.
      if (!locationService.hasIdentity) {
        await locationService.loadIdentity();
      }
      // Process the most recent location
      await locationService.processLocationUpdate(locations[locations.length - 1]);
    }
  }
});
