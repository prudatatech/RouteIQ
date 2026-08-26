/**
 * margixindia Driver App — Ola/Uber-Style Live GPS Location Service
 * 
 * ARCHITECTURE (same as Ola/Uber/Zomato):
 * 1. Phone GPS → BestForNavigation accuracy (street-level)
 * 2. GPS coordinates written DIRECTLY to Supabase cloud (always reachable)
 * 3. Supabase Realtime broadcasts changes to admin dashboard instantly
 * 4. Offline queue ensures no data loss on bad network
 * 
 * Flow: Phone GPS → Supabase vehicles table (lat/lng update)
 *                  → Supabase telemetry table (history insert)
 *       Dashboard ← Supabase Realtime subscription (instant update)
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { DEFAULT_PING_INTERVAL_MS, MIN_PING_INTERVAL_MS, MAX_PING_INTERVAL_MS } from '../config';

const QUEUE_KEY = 'margixindia_ping_queue';
const VEHICLE_ID_KEY = 'margixindia_vehicle_id';
const DRIVER_ID_KEY = 'margixindia_driver_id';
export const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';

interface LocationPing {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  accuracy: number;
  timestamp: string;
}

class LocationService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private watchSubscription: Location.LocationSubscription | null = null;
  private currentInterval: number = DEFAULT_PING_INTERVAL_MS;
  private isRunning = false;
  private vehicleId: string | null = null;
  private driverId: string | null = null;
  public onGeofenceAlert: ((alert: any) => void) | null = null;
  public onPendingCommand: ((commands: any[]) => void) | null = null;
  public onLocationUpdate: ((loc: LocationPing) => void) | null = null;
  private lastLat: number = 0;
  private lastLng: number = 0;
  private consecutiveErrors: number = 0;
  private lastGpsOffNotificationTime = 0;

  /**
   * Set the vehicle and driver IDs for this tracking session.
   * Call this after login or when vehicle is assigned.
   */
  async setIdentity(vehicleId: string, driverId: string) {
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
    onLocationUpdate?: (loc: LocationPing) => void,
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
    this.isRunning = true;
    this.consecutiveErrors = 0;

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

    if (this.vehicleId) {
      // Notify backend that GPS is intentionally turned off
      supabase
        .from('vehicles')
        .update({
          status: 'idle',
          last_heartbeat: new Date().toISOString()
        })
        .eq('id', this.vehicleId)
        .then(({ error }) => { if (error) console.error(error); else console.log('Backend notified: GPS OFF / Idle'); });
    }
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
          notificationTitle: "margixindia Tracking",
          notificationBody: "Location tracking is active for your route.",
          notificationColor: "#27A150",
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
      this.onLocationUpdate(ping);
    }

    // Only send if position actually changed (>2m)
    const dLat = Math.abs(ping.lat - this.lastLat);
    const dLng = Math.abs(ping.lng - this.lastLng);
    if (dLat > 0.00002 || dLng > 0.00002 || this.lastLat === 0) {
      await this.sendToSupabase(ping);
      this.lastLat = ping.lat;
      this.lastLng = ping.lng;
    }

  }

  /**
   * Collect GPS and send DIRECTLY to Supabase cloud.
   * No local backend needed — data goes straight to the cloud.
   */
  private async collectAndSend() {
    try {
      const gpsEnabled = await Location.hasServicesEnabledAsync();
      if (!gpsEnabled) {
        // Trigger local push notification to alert driver, throttled to once per 60s
        const now = Date.now();
        if (now - this.lastGpsOffNotificationTime > 60000) {
          this.lastGpsOffNotificationTime = now;
          await Notifications.scheduleNotificationAsync({
            content: {
              title: "GPS is Off!",
              body: "Please turn on your location to continue your active delivery.",
              sound: 'uber_driver_sound.mp3',
              autoDismiss: false,
            },
            trigger: { seconds: 1, channelId: 'alarms' } as any,
          });
        }

        if (this.vehicleId) {
          await supabase
            .from('vehicles')
            .update({
              last_heartbeat: new Date().toISOString(),
              status: 'idle',
            })
            .eq('id', this.vehicleId);
        }
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

      // Send queued pings first (offline replay)
      const queue = await this.getQueue();
      for (const queuedPing of queue) {
        await this.sendToSupabase(queuedPing);
      }
      if (queue.length > 0) {
        await this.clearQueue();
      }

      // Send current ping
      await this.sendToSupabase(ping);
      this.lastLat = ping.lat;
      this.lastLng = ping.lng;
      this.consecutiveErrors = 0;

    } catch (e) {
      console.warn('Location collection failed:', e);
      this.consecutiveErrors++;
    }
  }

  /**
   * Write GPS data DIRECTLY to Supabase.
   * Updates: vehicles.latitude/longitude (live position)
   * Inserts: telemetry row (history trail)
   */
  private async sendToSupabase(ping: LocationPing) {
    if (!this.vehicleId) return;

    try {
      // 1. UPDATE vehicle's live position in Supabase
      const { error: vehicleError } = await supabase
        .from('vehicles')
        .update({
          latitude: ping.lat,
          longitude: ping.lng,
          last_heartbeat: new Date().toISOString(),
          status: ping.speed > 2 ? 'on_route' : 'idle',
        })
        .eq('id', this.vehicleId);

      if (vehicleError) {
        console.error('Supabase vehicle update error:', vehicleError.message);
        // Queue for retry
        const queue = await this.getQueue();
        queue.push(ping);
        await this.saveQueue(queue);
        return;
      }

      // 2. INSERT telemetry record for history trail
      const speedKmph = ping.speed > 50 ? ping.speed : ping.speed * 3.6;
      const uuidv4 = () => {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      };

      const { error: telemetryError } = await supabase
        .from('telemetry')
        .insert({
          id: uuidv4(),
          vehicle_id: this.vehicleId,
          latitude: ping.lat,
          longitude: ping.lng,
          speed_kmph: parseFloat(speedKmph.toFixed(1)),
          heading: ping.heading,
          fuel_level_pct: null,
          timestamp: ping.timestamp,
        });

      if (telemetryError) {
        console.warn('Telemetry insert warning:', telemetryError.message);
        // Non-fatal — vehicle position already updated
      }

      // 3. Check geofence proximity
      await this.checkGeofence(ping);

      console.log(`📍 GPS → Supabase: ${ping.lat.toFixed(6)}, ${ping.lng.toFixed(6)} | ${speedKmph.toFixed(0)} km/h | acc: ${ping.accuracy.toFixed(0)}m`);

    } catch (networkError: any) {
      // Network failure → queue for offline replay
      console.warn('Supabase unreachable, queuing ping:', networkError.message);
      const queue = await this.getQueue();
      queue.push(ping);
      await this.saveQueue(queue);
    }
  }

  /**
   * Geofence check — if within 50m of a delivery point, alert the driver.
   */
  private async checkGeofence(ping: LocationPing) {
    if (!this.vehicleId || !this.onGeofenceAlert) return;

    try {
      const { data: activeRoutes } = await supabase
        .from('routes')
        .select('id, route_stops(id, delivery_point_id, sequence, status, delivery_points(id, name, latitude, longitude))')
        .eq('vehicle_id', this.vehicleId)
        .eq('status', 'active');

      if (!activeRoutes || activeRoutes.length === 0) return;

      for (const route of activeRoutes) {
        const pendingStops = (route.route_stops || [])
          .filter((s: any) => s.status === 'pending')
          .sort((a: any, b: any) => a.sequence - b.sequence);

        for (const stop of pendingStops) {
          const dp: any = Array.isArray(stop.delivery_points) ? stop.delivery_points[0] : stop.delivery_points;
          if (!dp) continue;

          // Haversine distance
          const R = 6371000;
          const dLat = ((dp.latitude - ping.lat) * Math.PI) / 180;
          const dLng = ((dp.longitude - ping.lng) * Math.PI) / 180;
          const a = Math.sin(dLat / 2) ** 2 +
            Math.cos((ping.lat * Math.PI) / 180) *
            Math.cos((dp.latitude * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
          const dist = 2 * R * Math.asin(Math.sqrt(a));

          if (dist <= 50) {
            this.onGeofenceAlert({
              type: 'GEOFENCE_ARRIVAL',
              stop_id: stop.id,
              delivery_point_id: dp.id,
              delivery_point_name: dp.name,
              distance_meters: Math.round(dist),
              message: `You are ${Math.round(dist)}m from ${dp.name}. Did you deliver?`,
            });
            return; // Only one alert at a time
          }
        }
      }
    } catch (e) {
      // Non-fatal
      console.warn('Geofence check failed:', e);
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
      // Process the most recent location
      await locationService.processLocationUpdate(locations[locations.length - 1]);
    }
  }
});
