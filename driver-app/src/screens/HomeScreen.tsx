/**
 * margixindia Driver App — Home Screen
 * Shows today's route, tracking status, and quick actions.
 */
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
  Linking,
  Modal,
  TextInput,
  Animated,
  Vibration,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../services/api';
import { locationService } from '../services/location';
import { supabase } from '../services/supabase';
import { useTranslation } from '../hooks/useTranslation';
import MapView, { Marker, Polyline, Region, PROVIDER_GOOGLE } from 'react-native-maps';
import BackhaulPopup from '../components/BackhaulPopup';
import SwipeButton from '../components/SwipeButton';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Audio } from 'expo-av';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReturnTripScreen from './ReturnTripScreen';
import LiveRateMarquee from '../components/LiveRateMarquee';

interface HomeScreenProps {
  onLogout: () => void;
  onNavigateToMap: (lat?: number, lng?: number) => void;
}

const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3; // metres
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

export default function HomeScreen({ onLogout, onNavigateToMap }: HomeScreenProps) {
  const { t, lang, setLanguage, isLoaded } = useTranslation();
  const [driverInfo, setDriverInfo] = useState<any>(null);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [routeData, setRouteData] = useState<any>(null);
  const [activeVehicleId, setActiveVehicleId] = useState<string | null>(null);
  const [activeVehicle, setActiveVehicle] = useState<any>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<any>(null);
  const [pendingRoute, setPendingRoute] = useState<any>(null);
  const pendingRouteRef = useRef<any>(null);
  const [showReturnTrip, setShowReturnTrip] = useState(false);

  // Step-by-step driver guidance state
  // Steps: 'accept' → 'start_tracking' → 'navigate_depot' → 'pickup' → 'delivering' → 'done'
  const [driverStep, setDriverStep] = useState<string>('idle');

  // New Premium Features State
  const [showPodModal, setShowPodModal] = useState(false);
  const [activeStopId, setActiveStopId] = useState<string | null>(null);
  const [signatureData, setSignatureData] = useState('');

  // Cargo Manifest Declaration
  const [showCapacityModal, setShowCapacityModal] = useState(false);
  const [declaringCapacity, setDeclaringCapacity] = useState(false);

  const [showSosModal, setShowSosModal] = useState(false);
  const [sosDescription, setSosDescription] = useState('');

  const [isTracking, setIsTracking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pingInterval, setPingInterval] = useState(10);
  const [vehicleReady, setVehicleReady] = useState(false);
  const [liveSpeed, setLiveSpeed] = useState(0);

  const [activeTab, setActiveTab] = useState<'route' | 'wallet' | 'profile'>('route');
  const [earningsData, setEarningsData] = useState<any>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);

  const [isNavigatingState, setIsNavigatingState] = useState(false);
  const isNavigatingRef = useRef(false);
  const mapRef = useRef<MapView>(null);

  // Track live location for relocate feature
  const [currentLoc, setCurrentLoc] = useState<{ lat: number, lng: number } | null>(null);
  const [mapRegion, setMapRegion] = useState<Region | undefined>(undefined);

  const [showBackhaulPopup, setShowBackhaulPopup] = useState(false);

  // --- Dispatch Call State ---
  const [incomingCall, setIncomingCall] = useState<{ caller: string } | null>(null);

  const queryClient = useQueryClient();

  const { data: routeDataQ, refetch: refetchRoute } = useQuery({
    queryKey: ['myRoute'],
    queryFn: () => api.getMyRoute(),
    refetchInterval: 15000, // Poll every 15s to keep it fresh without manual reload
    staleTime: 10000,
  });

  const { data: earningsDataQ, refetch: refetchEarnings } = useQuery({
    queryKey: ['earnings'],
    queryFn: () => api.getDriverEarnings(),
    enabled: activeTab === 'wallet',
    refetchInterval: 60000, // Update earnings every 1 min
    staleTime: 30000,
  });

  useEffect(() => {
    if (routeDataQ) {
      setRouteData(routeDataQ);
      AsyncStorage.setItem('cached_route', JSON.stringify(routeDataQ)).catch(() => { });
    }
  }, [routeDataQ]);

  useEffect(() => {
    // Load from cache on mount for instant state recovery
    AsyncStorage.getItem('cached_route').then((data) => {
      if (data && !routeData) {
        try { setRouteData(JSON.parse(data)); } catch (e) { }
      }
    });
  }, []);

  useEffect(() => {
    if (earningsDataQ) {
      setEarningsData(earningsDataQ);
    }
  }, [earningsDataQ]);

  const handleGeofencedAction = (targetLat: number | null | undefined, targetLng: number | null | undefined, action: () => void) => {
    if (!currentLoc) {
      Alert.alert(t('alert_gps_req_title'), t('alert_gps_req_desc'));
      return;
    }
    if (!targetLat || !targetLng) {
      // If target has no location, just allow it
      action();
      return;
    }

    const dist = getDistance(currentLoc.lat, currentLoc.lng, targetLat, targetLng);
    if (dist > 200) {
      Alert.alert(
        t('alert_geofence_title'),
        `${t('alert_geofence_desc')} (${Math.round(dist)}m)`,
        [
          { text: t('cancel'), style: 'cancel' },
          { text: t('yes'), onPress: action },
        ]
      );
    } else {
      action();
    }
  };

  // --- Notification Ring & Animation State ---
  const soundRef = useRef<Audio.Sound | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    loadData();
  }, [activeTab]);

  // Dedicated wallet fetch
  useEffect(() => {
    if (activeTab === 'wallet') {
      refetchEarnings();
    }
  }, [activeTab]);

  const [gpsOffAlert, setGpsOffAlert] = useState(false);

  // Poll GPS status if on an active route
  useEffect(() => {
    const checkGps = async () => {
      if (routeData && routeData.active) {
        const gpsEnabled = await Location.hasServicesEnabledAsync();
        setGpsOffAlert(!gpsEnabled);
      } else {
        setGpsOffAlert(false);
      }
    };
    checkGps();
    const interval = setInterval(checkGps, 10000);
    return () => clearInterval(interval);
  }, [routeData]);

  // Recurring local push notifications for pending routes (Native Trigger for background support)
  useEffect(() => {
    let notificationId: string | undefined;

    const scheduleRepeatingNotification = async () => {
      if (pendingRoute || pendingConfirmation) {
        notificationId = await Notifications.scheduleNotificationAsync({
          content: {
            title: "Action Required!",
            body: pendingRoute ? "You have a new route assigned. Please accept it." : "Please confirm your delivery status.",
            sound: 'uber_driver_sound.mp3',
          },
          trigger: { seconds: 30, repeats: true, channelId: 'alarms' } as any,
        });
      }
    };

    scheduleRepeatingNotification();

    return () => {
      if (notificationId) {
        Notifications.cancelScheduledNotificationAsync(notificationId);
      }
    };
  }, [pendingRoute, pendingConfirmation]);

  useEffect(() => {
    let isMounted = true;

    if (pendingConfirmation || pendingRoute || incomingCall || gpsOffAlert) {
      // Start pulse animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.05, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      ).start();

      // Vibrate aggressively (looping)
      Vibration.vibrate([500, 500, 500], true);

      // Play ringing sound
      const playSound = async () => {
        try {
          const { sound } = await Audio.Sound.createAsync(
            require('../../assets/uber_driver_sound.mp3'),
            { isLooping: true, volume: 1.0 }
          );
          if (isMounted) {
            soundRef.current = sound;
            await sound.playAsync();
          } else {
            sound.unloadAsync();
          }
        } catch (e) {
          console.warn("Failed to play notification sound", e);
        }
      };
      playSound();
    } else {
      // Stop animation and sound when confirmation goes away
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      Vibration.cancel();

      if (soundRef.current) {
        soundRef.current.stopAsync().then(() => soundRef.current?.unloadAsync());
        soundRef.current = null;
      }
    }

    return () => {
      isMounted = false;
      Vibration.cancel();
      if (soundRef.current) {
        soundRef.current.stopAsync().then(() => soundRef.current?.unloadAsync());
        soundRef.current = null;
      }
    };
  }, [pendingConfirmation, pendingRoute, incomingCall, gpsOffAlert]);
  // -------------------------------------------

  const setIsNavigating = (val: boolean) => {
    isNavigatingRef.current = val;
    setIsNavigatingState(val);
  };
  const isNavigating = isNavigatingState;

  const [snappedRoute, setSnappedRoute] = useState<any[]>([]);
  const [liveDistance, setLiveDistance] = useState<number | null>(null);
  const [liveDuration, setLiveDuration] = useState<number | null>(null);

  const routeSignature = useMemo(() => {
    if (!routeData?.route) return '';
    return JSON.stringify(
      (routeData.route.stops || []).filter((s: any) => s.status === 'pending').map((s: any) => s.id)
    );
  }, [routeData]);

  useEffect(() => {
    if (!routeData?.active || !routeData?.route) {
      setSnappedRoute([]);
      setLiveDistance(null);
      setLiveDuration(null);
      return;
    }

    const pendingStops = (routeData.route.stops || [])
      .filter((s: any) => s.status === 'pending' && s.delivery_point?.latitude && s.delivery_point?.longitude)
      .map((s: any) => ({
        latitude: Number(s.delivery_point.latitude),
        longitude: Number(s.delivery_point.longitude),
      }));

    let waypoints = [];
    if (currentLoc && pendingStops.length > 0) {
      waypoints = [
        { latitude: currentLoc.lat, longitude: currentLoc.lng },
        ...pendingStops
      ];
    } else {
      waypoints = pendingStops;
    }

    if (waypoints.length < 2) {
      setSnappedRoute(waypoints);
      return;
    }

    // Limit to 20 waypoints (OSRM public API limits)
    const safeWaypoints = waypoints.slice(0, 20);
    const coordinatesString = safeWaypoints.map((wp: any) => `${wp.longitude},${wp.latitude}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordinatesString}?overview=full&geometries=geojson`;

    fetch(url)
      .then(res => res.json())
      .then(data => {
        if (data.routes && data.routes.length > 0) {
          const routeInfo = data.routes[0];
          const coords = routeInfo.geometry.coordinates.map((coord: number[]) => ({
            latitude: coord[1],
            longitude: coord[0]
          }));
          setSnappedRoute(coords);
          setLiveDistance(routeInfo.distance);
          setLiveDuration(routeInfo.duration);
        } else {
          setSnappedRoute(safeWaypoints);
          setLiveDistance(null);
          setLiveDuration(null);
        }
      })
      .catch(err => {
        console.warn('OSRM fetch failed:', err);
        setSnappedRoute(safeWaypoints);
      });
  }, [routeData?.active, routeSignature, currentLoc ? 'has_loc' : 'no_loc']);


  const loadData = useCallback(async () => {
    try {
      const info = await api.getDriverInfo();
      setDriverInfo(info);
      const savedAvatar = await AsyncStorage.getItem('driver_avatar_uri');
      if (savedAvatar) setAvatarUri(savedAvatar);

      if (activeTab === 'wallet') {
        refetchEarnings();
      }


      let vehicleId = null;
      // Auto-discover vehicle from Supabase for GPS tracking
      if (info?.id) {
        vehicleId = await locationService.autoDiscoverVehicle(info.id);
        if (vehicleId) {
          setActiveVehicleId(vehicleId);
          setVehicleReady(true);
          try {
            const vInfo = await api.getVehicleInfo(vehicleId);
            setActiveVehicle(vInfo);
          } catch (e) { }
        }
      }

      try {
        const { data: route } = await refetchRoute();
        if (route) {
          setRouteData(route);
          // Cache the fresh route
          await AsyncStorage.setItem('cached_route', JSON.stringify(route));
        }

        if (route?.route && (route.route.status === 'active' || route.route.status === 'pending')) {
          const lastSeenId = await AsyncStorage.getItem('last_seen_route_id');
          if (route.route.id !== lastSeenId && pendingRouteRef.current?.id !== route.route.id) {
            pendingRouteRef.current = route.route;
            setPendingRoute(route.route);
          }
        }
      } catch (routeErr: any) {
        if (routeErr.message?.includes('No vehicle assigned') || routeErr.message?.includes('Request failed') || routeErr.message?.includes('JSON')) {
          setRouteData(null);
          await AsyncStorage.removeItem('cached_route');
        }
      }

      // Check for pending confirmations
      if (vehicleId) {
        const { data: confs } = await supabase
          .from('driver_confirmations')
          .select('*, route_stops(delivery_points(name))')
          .eq('vehicle_id', vehicleId)
          .is('action', null)
          .order('prompted_at', { ascending: false })
          .limit(1);

        if (confs && confs.length > 0) {
          setPendingConfirmation(confs[0]);
          // Ack delivery if not acked
          if (!confs[0].delivered_at) {
            await api.ackStop(confs[0].id);
          }
        } else {
          setPendingConfirmation(null);
        }
      }

      return vehicleId;
    } catch (e: any) {
      return null;
    }
  }, []);

  useEffect(() => {
    setIsTracking(locationService.isTracking);

    // Restore tracking state
    AsyncStorage.getItem('tracking_active').then((val) => {
      if (val === 'true' && !locationService.isTracking) {
        // Auto-start tracking if it was on
        toggleTracking(true);
      }
    });

    let sub: any = null;
    let marketplaceSub: any = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    api.init().then(async () => {
      const vId = await loadData();

      // --- Supabase Realtime subscriptions (guarded against null vId) ---
      if (vId) {
        sub = supabase.channel(`driver-route-events-${vId}`)
          .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'routes',
            filter: `vehicle_id=eq.${vId}`
          }, (payload) => {
            console.log('[Realtime] New route INSERT detected:', payload.new?.id);
            setPendingRoute(payload.new);
            loadData();
          })
          .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'routes',
            filter: `vehicle_id=eq.${vId}`
          }, (payload) => {
            console.log('[Realtime] Route UPDATE detected:', payload.new?.id, 'status:', (payload.new as any)?.status);
            loadData();
          })
          .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'cargo_manifest',
            filter: `vehicle_id=eq.${vId}`
          }, (payload) => {
            console.log('[Realtime] New cargo_manifest INSERT detected:', payload.new?.id);
            // Map manifest to route shape for the popup
            const mRoute = {
              id: payload.new.id,
              status: payload.new.status === 'scheduled' ? 'pending' : 'in_progress',
              route_type: payload.new.route_type || 'forward',
              stops: []
            };
            setPendingRoute(mRoute);
            loadData();
          })
          .subscribe((status: string) => {
            console.log('[Realtime] Route channel status:', status);
          });

        // Trust Safety Valve Realtime Listener
        marketplaceSub = supabase.channel(`driver-confs-${vId}`)
          .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'driver_confirmations',
            filter: `vehicle_id=eq.${vId}`
          }, async (payload) => {
            Alert.alert(
              t('alert_next_stop_title'),
              t('alert_next_stop_desc'),
              [{ text: t('view_map'), onPress: loadData }]
            );
            // Set it directly, and auto-ack
            setPendingConfirmation(payload.new);
            await api.ackStop(payload.new.id);
            loadData();
          })
          .on('broadcast', { event: 'INCOMING_DISPATCH_CALL' }, (payload) => {
            console.log('[Realtime] Incoming dispatch call:', payload);
            setIncomingCall(payload.payload || { caller: 'Dispatch' });
          })
          .subscribe((status: string) => {
            console.log('[Realtime] Confirmations channel status:', status);
          });
      } else {
        console.warn('[Realtime] No vehicle ID found — skipping Supabase subscriptions');
      }

      // --- Polling fallback: check for new routes every 15s ---
      // This ensures drivers get notified even if Supabase Realtime drops
      pollInterval = setInterval(() => {
        console.log('[Poll] Checking for new routes...');
        loadData();
      }, 15000);
    });

    // Get initial location on mount so map and routing work before tracking starts
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setCurrentLoc({ lat: loc.coords.latitude, lng: loc.coords.longitude });
        }
      } catch (e) {
        console.warn('Initial location fetch failed:', e);
      }
    })();

    return () => {
      if (sub) supabase.removeChannel(sub);
      if (marketplaceSub) supabase.removeChannel(marketplaceSub);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // ── Toggle Tracking ────────────────────────────────────────
  const toggleTracking = async (forceStart = false) => {
    if (isTracking && !forceStart) {
      if (route && route.status === 'active') {
        Alert.alert(
          t('cannot_pause_title') || 'Cannot Pause Tracking',
          t('cannot_pause_desc') || 'You cannot pause GPS tracking while you have an active assigned route.'
        );
        return;
      }
      locationService.stop();
      setIsTracking(false);
      await AsyncStorage.setItem('tracking_active', 'false');
      try { deactivateKeepAwake(); } catch (e) { }
    } else if (!isTracking || forceStart) {
      // Resume from break if any
      try { await api.setBreakStatus(false); } catch (e) { }

      const result = await locationService.start(
        // Geofence alert handler
        (alert) => {
          Alert.alert(
            t('alert_arrived_title'),
            alert.message,
            [
              { text: t('not_yet'), style: 'cancel' },
              {
                text: t('mark_delivered'),
                onPress: () => openPodModal(alert.stop_id),
              },
            ]
          );
        },
        // Pending commands handler
        (commands) => {
          for (const cmd of commands) {
            if (cmd.type === 'sync' && cmd.action === 'fetch_route') {
              console.log('Received fetch_route command, refreshing route...');
              loadData();
            } else if (cmd.type === 'config' && cmd.action === 'set_interval' && cmd.payload?.seconds) {
              console.log('Updating ping interval to:', cmd.payload.seconds);
              setPingInterval(cmd.payload.seconds);
            }
          }
        },
        // Location update handler
        (loc) => {
          setLiveSpeed(loc.speed);
          setCurrentLoc({ lat: loc.lat, lng: loc.lng });
          if (isNavigatingRef.current && mapRef.current) {
            mapRef.current.animateCamera({
              center: { latitude: loc.lat, longitude: loc.lng },
              heading: loc.heading,
              pitch: 60,
              zoom: 18,
            }, { duration: 1000 });
          }
        }
      );
      if (!result.success) {
        Alert.alert('Tracking Failed', result.error);
      } else {
        setIsTracking(true);
        await AsyncStorage.setItem('tracking_active', 'true');
        try { await activateKeepAwakeAsync(); } catch (e) { }
      }
    }
  };

  const handleTakeBreak = () => {
    Alert.alert(t('alert_take_break_title'), t('alert_take_break_desc'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('alert_take_break_title'),
        onPress: async () => {
          try {
            locationService.stop();
            setIsTracking(false);
            await AsyncStorage.setItem('tracking_active', 'false');
            await api.setBreakStatus(true);
            Alert.alert(t('alert_break_started_title'), t('alert_break_started_desc'));
          } catch (err: any) {
            Alert.alert(t('error'), t('error'));
          }
        }
      }
    ]);
  };

  const handleFailStop = (stopId: string) => {
    Alert.alert(t('alert_report_issue_title'), t('alert_report_issue_desc'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('mark_failed'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.completeStop({ stop_id: stopId, status: 'failed' });
            Alert.alert(t('alert_reported_title'), t('alert_reported_desc'));
            loadData();
          } catch (err: any) {
            Alert.alert(t('error'), err.message);
          }
        },
      },
    ]);
  };

  const openPodModal = (stopId: string) => {
    setActiveStopId(stopId);
    setSignatureData('');
    setShowPodModal(true);
  };

  const submitCompleteStop = async () => {
    if (!activeStopId) return;
    try {
      // Basic validation for signature data
      if (signatureData.trim().length < 3) {
        Alert.alert(t('required'), t('alert_valid_sig'));
        return;
      }
      const res = await api.completeStop({
        stop_id: activeStopId,
        status: 'completed',
        signature_data: signatureData
      });
      setShowPodModal(false);
      setActiveStopId(null);
      await loadData();

      if (res.route_completed) {
        Alert.alert(t('alert_route_completed_title'), t('alert_route_completed_desc'), [
          { text: t('no'), style: 'cancel' },
          {
            text: t('yes_find_cargo'), onPress: () => {
              if (activeVehicleId) {
                api.openBackhaulWindow(activeVehicleId, activeVehicle?.capacity_kg || 1000, 'return_trip');
                setShowBackhaulPopup(true);
              }
            }
          }
        ]);
      } else {
        Alert.alert('Success', 'Stop marked as completed!');
      }
    } catch (e: any) {
      Alert.alert(t('error'), e.message || 'Failed to complete stop');
    }
  };


  const submitCapacity = async (percentage: number) => {
    if (!activeVehicleId) return;
    setDeclaringCapacity(true);
    try {
      await api.declareCapacity(activeVehicleId, percentage);
      setShowCapacityModal(false);
      Alert.alert('Success', `Capacity declared at ${percentage}%`);
    } catch (e: any) {
      Alert.alert(t('error'), e.message || 'Failed to declare capacity');
    } finally {
      setDeclaringCapacity(false);
    }
  };

  const handleSOS = async (type: string) => {
    if (!activeVehicleId) return;
    try {
      Alert.alert(t('sos_sending') || 'Sending SOS', t('sos_wait') || 'Please wait...', [], { cancelable: false });
      let lat = 0;
      let lng = 0;
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        lat = loc.coords.latitude;
        lng = loc.coords.longitude;
      } catch (e) {
        console.warn('Could not get exact location for SOS', e);
      }
      await api.reportSOS(activeVehicleId, type, sosDescription || `Driver triggered ${type} emergency`, lat, lng);
      Alert.alert(t('sos_sent_title') || 'SOS Sent', t('sos_sent_desc') || 'Fleet manager notified.');
      setShowSosModal(false);
      setSosDescription('');
    } catch (e: any) {
      Alert.alert(t('sos_failed') || 'SOS Failed', e.message);
    }
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure?', [
      { text: t('cancel'), style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          locationService.stop();
          await api.logout();
          onLogout();
        },
      },
    ]);
  };


  const route = routeData?.route;
  const hasRoute = routeData?.active && route;

  const handleNavigate = () => {
    if (!hasRoute) return;
    const pendingStops = (route?.stops || []).filter((s: any) => s.status === 'pending').sort((a: any, b: any) => a.sequence - b.sequence);
    const points = pendingStops.map((wp: any) => wp.delivery_point);
    if (pendingStops.length > 0) {
      const target = pendingStops[0].delivery_point;
      if (target?.latitude && target?.longitude) {
        onNavigateToMap(Number(target.latitude), Number(target.longitude));
        return;
      }
    }
    onNavigateToMap();
  };

  const handleGoogleMapsNavigation = async () => {
    if (!hasRoute) return;

    // 1. Auto-start live tracking so Admin Map gets the live details
    if (!isTracking) {
      await toggleTracking(true);
    }

    if (route.status === 'pending') {
      Alert.alert('Journey Not Started', 'Please start the journey first.');
      return;
    }

    // 2. Build Google Maps Route URL with waypoints
    const pendingStops = (route?.stops || []).filter((s: any) => s.status === 'pending').sort((a: any, b: any) => a.sequence - b.sequence);
    const stopsWithCoords = pendingStops.filter((s: any) => s.delivery_point?.latitude && s.delivery_point?.longitude);

    let url = '';
    if (route.status === 'active' && route.depot?.latitude && route.depot?.longitude) {
      url = `https://www.google.com/maps/dir/?api=1&destination=${route.depot.latitude},${route.depot.longitude}`;
    } else if (stopsWithCoords.length > 0) {
      const dest = stopsWithCoords[stopsWithCoords.length - 1].delivery_point;
      url = `https://www.google.com/maps/dir/?api=1&destination=${dest.latitude},${dest.longitude}`;

      if (stopsWithCoords.length > 1) {
        const waypoints = stopsWithCoords.slice(0, -1).map((s: any) => `${s.delivery_point.latitude},${s.delivery_point.longitude}`).join('%7C');
        url += `&waypoints=${waypoints}`;
      }
    }

    if (url) {
      try {
        await Linking.openURL(url);
      } catch (err) {
        Alert.alert(t('error'), 'Could not open Google Maps');
      }
      Alert.alert('Route Complete', 'No pending stops with locations.');
    }
  };

  const handleSaveName = async () => {
    const newName = editNameValue.trim();
    if (!newName) {
      Alert.alert('Invalid Name', 'Name cannot be empty.');
      return;
    }
    const nameRegex = /^[\p{L}\s.-]+$/u;
    if (!nameRegex.test(newName)) {
      Alert.alert('Invalid Name', 'Name cannot contain special characters like #, @, etc.');
      return;
    }

    try {
      const updatedInfo = { ...driverInfo, full_name: newName };
      setDriverInfo(updatedInfo);
      await api.updateProfile({ full_name: newName });
      setIsEditingName(false);
    } catch (e) {
      Alert.alert('Error', 'Failed to save name.');
    }
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const uri = result.assets[0].uri;
        setAvatarUri(uri);
        await AsyncStorage.setItem('driver_avatar_uri', uri);
      }
    } catch (e) {
      console.log('Image picker error', e);
    }
  };

  const renderRouteTab = () => (
    <>
      {/* Yellow Alert Banner (No active route) */}
      {(!hasRoute || route?.status === 'completed') && (
        <View style={{ marginHorizontal: 16, marginTop: 16, backgroundColor: '#FDE047', borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', marginBottom: -20, zIndex: 5, elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 }}>
          <View style={{ backgroundColor: '#FFF', width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
            <Ionicons name="megaphone-outline" size={24} color="#000" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#451A03' }}>{t('no_active_route_banner')}</Text>
            <Text style={{ fontSize: 12, color: '#78350F', marginTop: 2 }}>{t('bidding_in_progress')}</Text>
          </View>
          <MaterialCommunityIcons name="truck-fast" size={40} color="#000" />
        </View>
      )}

      {(() => {
        const firstPending = (route?.stops || []).find((s: any) => s.status === 'pending');
        return (
          <View style={{ height: 350, marginHorizontal: 24, borderRadius: 16, overflow: 'hidden', marginBottom: 24, borderWidth: 1, borderColor: '#E5E7EB' }}>
            <MapView
              ref={mapRef}
              provider={PROVIDER_GOOGLE}
              style={StyleSheet.absoluteFillObject}
              showsUserLocation={true}
              showsMyLocationButton={false}
              initialRegion={mapRegion || {
                latitude: Number(firstPending?.delivery_point?.latitude || route?.stops?.[0]?.delivery_point?.latitude || currentLoc?.lat || 19.1197),
                longitude: Number(firstPending?.delivery_point?.longitude || route?.stops?.[0]?.delivery_point?.longitude || currentLoc?.lng || 72.8464),
                latitudeDelta: 0.1,
                longitudeDelta: 0.1,
              }}
              onRegionChangeComplete={setMapRegion}
            >
              {snappedRoute && snappedRoute.length > 1 && (
                <Polyline coordinates={snappedRoute} strokeColor="#4285F4" strokeWidth={5} />
              )}
              {(route?.stops || []).map((stop: any, idx: number) => {
                if (!stop.delivery_point?.latitude || !stop.delivery_point?.longitude) return null;
                return (
                  <Marker
                    key={stop.id}
                    coordinate={{
                      latitude: Number(stop.delivery_point.latitude),
                      longitude: Number(stop.delivery_point.longitude),
                    }}
                    title={stop.delivery_point.name}
                    pinColor={stop.status === 'completed' ? '#27A150' : '#E23744'}
                  />
                )
              })}
            </MapView>

            <TouchableOpacity
              style={styles.relocateFab}
              onPress={async () => {
                if (mapRef.current && currentLoc) {
                  mapRef.current.animateCamera({
                    center: { latitude: currentLoc.lat, longitude: currentLoc.lng },
                    zoom: 16
                  }, { duration: 200 });
                } else if (mapRef.current) {
                  try {
                    const { status } = await Location.requestForegroundPermissionsAsync();
                    if (status === 'granted') {
                      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                      mapRef.current.animateCamera({
                        center: { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
                        zoom: 16
                      }, { duration: 200 });
                    }
                  } catch (e) {
                    console.warn(e);
                  }
                }
              }}
            >
              <Ionicons name="location-outline" size={18} color="#111827" />
            </TouchableOpacity>

            {isNavigating && (
              <View style={styles.speedometerOverlay}>
                <Text style={styles.speedometerValue}>{Math.round(liveSpeed * 3.6)}</Text>
                <Text style={styles.speedometerUnit}>KM/H</Text>
              </View>
            )}
          </View>
        );
      })()}

      {/* Route Card & Map */}
      {hasRoute ? (
        <View style={styles.routeCard}>
          {/* Route Overview (Bottom Sheet Header) */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="cube-outline" size={20} color="#111827" />
              <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#CA8A04' }}>{t('trip_details') || "Today's Journey"} ({route.status === 'pending' ? 'Pending' : 'Active'})</Text>
            </View>
            <TouchableOpacity style={{ backgroundColor: '#F57C00', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
              <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 12 }}>{t('view_map') || 'View'}</Text>
            </TouchableOpacity>
          </View>

          {/* 3-Column Stats */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#E5E7EB', paddingVertical: 12, marginBottom: 12 }}>
            <View style={{ alignItems: 'center', flex: 1, borderRightWidth: 1, borderColor: '#E5E7EB' }}>
              <Text style={{ fontSize: 12, color: '#111827', fontWeight: 'bold' }}>{t('distance_label') || 'Total Distance'}</Text>
              <Text style={{ fontSize: 16, color: '#111827', fontWeight: '900', marginTop: 4 }}>
                {liveDistance ? `${(liveDistance / 1000).toFixed(0)} km` : (route.total_distance_km ? `${route.total_distance_km.toFixed(0)} km` : '--')}
              </Text>
            </View>
            <View style={{ alignItems: 'center', flex: 1, borderRightWidth: 1, borderColor: '#E5E7EB' }}>
              <Text style={{ fontSize: 12, color: '#111827', fontWeight: 'bold' }}>{t('expected_time') || 'Approx Time'}</Text>
              <Text style={{ fontSize: 16, color: '#111827', fontWeight: '900', marginTop: 4 }}>
                {(liveDistance || route.total_distance_km) ? (() => {
                  const distKm = liveDistance ? (liveDistance / 1000) : route.total_distance_km;
                  const totalMins = Math.round((distKm / 40) * 60);
                  if (totalMins < 60) return `${totalMins}m`;
                  const hrs = Math.floor(totalMins / 60);
                  const remainingMins = totalMins % 60;
                  return remainingMins > 0 ? `${hrs}h ${remainingMins}m` : `${hrs}h`;
                })() : '--'}
              </Text>
            </View>
            <View style={{ alignItems: 'center', flex: 1 }}>
              <Text style={{ fontSize: 12, color: '#111827', fontWeight: 'bold' }}>{t('all_stops') || 'Total Stops'}</Text>
              <Text style={{ fontSize: 16, color: '#111827', fontWeight: '900', marginTop: 4 }}>{route.stops?.length || 0}</Text>
              <Text style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>{route.stops?.filter((s: any) => s.stop_type === 'pickup').length || 0} {t('pickup_label') || 'Pickup'} • {route.stops?.filter((s: any) => s.stop_type === 'dropoff').length || 0} {t('drop_label') || 'Delivery'}</Text>
            </View>
          </View>

          {/* Next Stop Callout & Start Button */}
          {(() => {
            const next = (route.stops || []).find((s: any) => s.status === 'pending');
            return (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={{ fontSize: 12, color: '#2563EB', fontWeight: 'bold' }}>{t('next_stop') || 'Next Stop'}:</Text>
                  <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#111827', marginTop: 2 }} numberOfLines={2}>{next?.delivery_point?.name || '--'}</Text>
                  <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{next?.stop_type === 'pickup' ? (t('pickup_label') || 'Pickup') : (t('drop_label') || 'Delivery')} • --</Text>
                </View>
                <TouchableOpacity
                  style={{ backgroundColor: '#FDE047', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, minWidth: 150 }}
                  onPress={async () => {
                    if (route.status === 'pending') {
                      try { await api.startRoute(route.id); loadData(); } catch (e) { }
                    } else if (route.status === 'active' && !isTracking) {
                      await toggleTracking(true);
                    } else if (route.status === 'active' && isTracking) {
                      // Already started and tracking, so open maps as action
                      handleGoogleMapsNavigation();
                    }
                  }}
                >
                  <Ionicons name="play" size={18} color="#451A03" style={{ marginRight: 8 }} />
                  <Text style={{ color: '#451A03', fontWeight: 'bold', fontSize: 14, textAlign: 'center' }}>{t('start_journey') || 'Start Journey'}</Text>
                </TouchableOpacity>
              </View>
            );
          })()}

          {/* 6-Button Action Grid */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
            <TouchableOpacity style={{ width: '47%', backgroundColor: '#FFF', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', flexDirection: 'row', alignItems: 'center' }} onPress={handleGoogleMapsNavigation}>
              <Ionicons name="compass-outline" size={24} color="#CA8A04" style={{ marginRight: 8 }} />
              <View>
                <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#CA8A04' }}>{t('action_navigation')}</Text>
                <Text style={{ fontSize: 10, color: '#6B7280' }}>{t('view_route_sub') || 'View Route'}</Text>
              </View>
            </TouchableOpacity>

            {(() => {
              const currentStop = (route.stops || []).find((s: any) => s.status === 'pending');
              const isPickup = currentStop?.stop_type === 'pickup';
              return (
                <TouchableOpacity style={{ width: '47%', backgroundColor: '#FFF', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', flexDirection: 'row', alignItems: 'center' }} onPress={() => {
                  if (currentStop) {
                    // Match coordinates for either pickup or delivery
                    const targetLat = currentStop.delivery_point?.latitude || currentStop.pickup_point?.latitude;
                    const targetLng = currentStop.delivery_point?.longitude || currentStop.pickup_point?.longitude;
                    handleGeofencedAction(targetLat, targetLng, () => openPodModal(currentStop.id));
                  }
                }}>
                  {isPickup ? <Ionicons name="cube-outline" size={24} color="#CA8A04" style={{ marginRight: 8 }} /> : <Ionicons name="clipboard-outline" size={24} color="#1D4ED8" style={{ marginRight: 8 }} />}
                  <View>
                    <Text style={{ fontSize: 14, fontWeight: 'bold', color: isPickup ? '#CA8A04' : '#1D4ED8' }}>
                      {isPickup ? (t('pickup_label') || 'Pickup') : t('action_deliver')}
                    </Text>
                    <Text style={{ fontSize: 10, color: '#6B7280' }}>
                      {isPickup ? (t('mark_picked_up') || 'Confirm Cargo Load') : (t('pod_sign_sub') || 'Take Sign / POD')}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })()}

            <TouchableOpacity style={{ width: '47%', backgroundColor: '#FFF', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', flexDirection: 'row', alignItems: 'center' }} onPress={() => setShowCapacityModal(true)}>
              <Ionicons name="cube-outline" size={24} color="#EA580C" style={{ marginRight: 8 }} />
              <View>
                <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#EA580C' }}>{t('action_backhaul')}</Text>
                <Text style={{ fontSize: 10, color: '#6B7280' }}>{t('backhaul_sub') || 'Find Backhaul Load'}</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={{ width: '47%', backgroundColor: '#FFF', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', flexDirection: 'row', alignItems: 'center' }} onPress={() => {
              const stop = (route.stops || []).find((s: any) => s.status === 'pending');
              if (stop) handleFailStop(stop.id);
            }}>
              <Ionicons name="warning-outline" size={24} color="#DC2626" style={{ marginRight: 8 }} />
              <View>
                <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#DC2626' }}>{t('action_issue')}</Text>
                <Text style={{ fontSize: 10, color: '#6B7280' }}>{t('report_issue_sub')}</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={{ width: '47%', backgroundColor: '#FFF', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', flexDirection: 'row', alignItems: 'center' }} onPress={handleTakeBreak}>
              <Ionicons name="cafe-outline" size={24} color="#6D28D9" style={{ marginRight: 8 }} />
              <View>
                <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#6D28D9' }}>{t('action_break')}</Text>
                <Text style={{ fontSize: 10, color: '#6B7280' }}>{t('take_break_sub')}</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={{ width: '47%', backgroundColor: '#FFF', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', flexDirection: 'row', alignItems: 'center' }} onPress={() => setShowSosModal(true)}>
              <MaterialCommunityIcons name="car-emergency" size={24} color="#DC2626" style={{ marginRight: 8 }} />
              <View>
                <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#DC2626' }}>{t('action_sos')}</Text>
                <Text style={{ fontSize: 10, color: '#6B7280' }}>{t('sos_sub')}</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Progress Stepper */}
          <View style={{ backgroundColor: '#F9FAFB', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#CA8A04' }}>{t('journey_progress') || 'Journey Progress'}</Text>
              <Text style={{ fontSize: 12, color: '#6B7280' }}>{route.completed_stops} / {route.stops?.length || 0} {t('stops_completed') || 'Stops Completed'}</Text>
            </View>
            {/* Custom Stepper Line */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
              <View style={{ position: 'absolute', left: 10, right: 10, top: 8, height: 2, backgroundColor: '#D1D5DB', zIndex: 0 }} />
              {[...Array(route.stops?.length || 4)].map((_, i) => (
                <View key={i} style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: i < route.completed_stops ? '#FDE047' : '#FFF', borderWidth: 2, borderColor: i < route.completed_stops ? '#FDE047' : '#9CA3AF', zIndex: 1 }} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
              <Text style={{ fontSize: 12, color: '#374151' }}>{t('start_point')}</Text>
              <Text style={{ fontSize: 12, color: '#374151' }}>{t('end_point')}</Text>
            </View>
          </View>

          {/* Stops List */}
          <Text style={styles.stopsTitle}>{t('all_stops')}</Text>
          {(route.stops || []).map((stop: any, idx: number) => (
            <View key={stop.id} style={styles.stopItem}>
              <View style={[styles.stopIcon, stop.status === 'completed' ? styles.stopDoneNew : styles.stopPending]}>
                <Text style={stop.status === 'completed' ? styles.stopIconDone : styles.stopIconText}>{stop.status === 'completed' ? '' : idx + 1}</Text>
              </View>
              <View style={styles.stopInfo}>
                <Text style={styles.stopName}>{stop.delivery_point?.name || `Stop ${idx + 1}`}</Text>
                <Text style={styles.stopAddress} numberOfLines={1}>
                  {stop.delivery_point?.address || 'No address'}
                </Text>
              </View>
              {stop.status === 'pending' && (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={[styles.deliverBtn, { backgroundColor: '#F2F2F2' }]}
                    onPress={() => handleFailStop(stop.id)}
                  >
                    <Text style={[styles.deliverBtnText, { color: '#686B78' }]}>{t('issue')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deliverBtn}
                    onPress={() => {
                      const targetLat = stop.delivery_point?.latitude || stop.pickup_point?.latitude;
                      const targetLng = stop.delivery_point?.longitude || stop.pickup_point?.longitude;
                      handleGeofencedAction(targetLat, targetLng, () => openPodModal(stop.id));
                    }}
                  >
                    <Text style={styles.deliverBtnText}>{stop.stop_type === 'pickup' ? (t('pickup_label') || 'Pickup') : t('deliver')}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}

          {/* Refresh Button at bottom */}
          <TouchableOpacity
            style={[styles.secondaryButton, { marginTop: 12, marginBottom: 8 }]}
            onPress={loadData}
          >
            <Text style={styles.secondaryButtonText}>{t('refresh') || 'Refresh Data'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.noRouteCard}>
          {route && route.status === 'completed' ? (
            <View style={styles.completedContainer}>
              <Ionicons name="checkmark-circle" size={64} color="#27A150" style={{ marginBottom: 16 }} />
              <Text style={styles.noRouteTitle}>{t('alert_route_completed_title') || 'Route Completed'}</Text>
              <Text style={styles.noRouteText}>{t('alert_route_completed_desc') || 'This order is done. Click on find return load.'}</Text>

              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  { marginTop: 20, backgroundColor: (route.completed_stops >= (route.stops?.length || 1)) ? '#009688' : '#A9A9A9' }
                ]}
                disabled={!(route.completed_stops >= (route.stops?.length || 1))}
                onPress={async () => {
                  if (!activeVehicleId) return;
                  await api.openBackhaulWindow(activeVehicleId, activeVehicle?.capacity_kg || 1000, 'return_trip');
                  setShowBackhaulPopup(true);
                }}
              >
                <Text style={styles.primaryButtonText}>{t('find_return_load_btn') || 'Find Return Load'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            route && route.status === 'active' && (!route.stops || route.stops.length === 0) ? (
              <>
                <Text style={styles.noRouteTitle}>Loading...</Text>
                <Text style={styles.noRouteText}>Bidding is going on for your next shipment. Please wait.</Text>
                {/* Simulated Loading Indicator */}
                <View style={{ marginTop: 20, alignItems: 'center' }}>
                  <Ionicons name="hourglass-outline" size={32} color="#6B7280" style={{ opacity: 0.5 }} />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.noRouteTitle}>No Active Route</Text>
                <Text style={styles.noRouteText}>You haven't been assigned a route for today yet.</Text>
                <TouchableOpacity style={styles.primaryButton} onPress={loadData}>
                  <Text style={styles.primaryButtonText}>Check for Updates</Text>
                </TouchableOpacity>
              </>
            )
          )}
        </View>
      )}


      {/* Trust Safety Valve: Driver Confirmations / New Route */}
      <Modal
        visible={!!(pendingConfirmation || pendingRoute)}
        transparent={true}
        animationType="slide"
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 }}>
          <View style={[styles.routeCard, { borderColor: '#FDE047', borderWidth: 2, backgroundColor: 'white', elevation: 10, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10 }]}>
            {/* Header with icon */}
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#FEF3C7', justifyContent: 'center', alignItems: 'center', marginBottom: 12 }}>
                {pendingRoute ? <MaterialCommunityIcons name="truck-delivery" size={28} color="#000" /> : <Ionicons name="location-outline" size={28} color="#000" />}
              </View>
              <Text style={[styles.routeTitle, { color: '#CA8A04', fontSize: 18, textAlign: 'center' }]}>
                {pendingRoute ? `${t('new_cargo_assigned')} - ${pendingRoute.route_type === 'backhaul' ? 'Backhaul/Return' : 'Forward'}` : `${t('new_stop_added')}`}
              </Text>
            </View>

            {/* Cargo details */}
            {pendingRoute && (
              <View style={{ backgroundColor: '#FEF9E7', borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#FDE04733' }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text style={{ fontSize: 11, color: '#92400E', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 }}>Route ID</Text>
                  <Text style={{ fontSize: 11, color: '#181B26', fontWeight: '700', fontFamily: 'monospace' }}>{pendingRoute.id?.slice(0, 8)}</Text>
                </View>
                {pendingRoute.stops?.length > 0 && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 11, color: '#92400E', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 }}>Stops</Text>
                    <Text style={{ fontSize: 11, color: '#181B26', fontWeight: '700' }}>{pendingRoute.stops.length} stops</Text>
                  </View>
                )}
              </View>
            )}

            <Text style={{ color: '#181B26', fontSize: 15, marginBottom: 20, textAlign: 'center', lineHeight: 22 }}>
              {pendingRoute
                ? t('cargo_route_msg')
                : `${t('cargo_stop_msg')} ${pendingConfirmation?.route_stops?.delivery_points?.name || 'Inserted Stop'}`}
            </Text>

            <View style={{ flexDirection: 'column', gap: 14 }}>
              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <View style={{ alignItems: 'center', marginBottom: 6 }}>
                  <Text style={{ color: '#27A150', fontWeight: '800', fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {t('tap_accept')}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: '#27A150', height: 60, borderRadius: 18 }]}
                  onPress={async () => {
                    try {
                      if (pendingConfirmation) {
                        await supabase.from('driver_confirmations').update({ action: 'confirmed', responded_at: new Date().toISOString() }).eq('id', pendingConfirmation.id);
                        setPendingConfirmation(null);
                        Alert.alert('', 'Stop accepted.');
                      } else if (pendingRoute) {
                        await AsyncStorage.setItem('last_seen_route_id', pendingRoute.id);
                        pendingRouteRef.current = null;
                        setPendingRoute(null);
                        setDriverStep('start_tracking');
                        Alert.alert(
                          ' Route Accepted!',
                          'Next step: Press "Start Journey" on the main screen to begin.',
                        );
                      }
                      loadData();
                    } catch (e) {
                      console.error(e);
                    }
                  }}
                >
                  <Text style={[styles.primaryButtonText, { fontSize: 18 }]}>{t('accept_btn')}</Text>
                </TouchableOpacity>
              </Animated.View>

              <TouchableOpacity
                style={[styles.secondaryButton, { height: 50 }]}
                onPress={async () => {
                  try {
                    if (pendingConfirmation) {
                      await api.flagStop(pendingConfirmation.id);
                      setPendingConfirmation(null);
                      Alert.alert('Flagged', 'Dispatcher notified.');
                    } else {
                      pendingRouteRef.current = null;
                      setPendingRoute(null);
                      Alert.alert('Flagged', 'Dispatcher notified.');
                    }
                    loadData();
                  } catch (e) {
                    console.error(e);
                  }
                }}
              >
                <Text style={styles.secondaryButtonText}>{t('flag_issue')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Declare Capacity Button (CapacityWatcher placeholder for driver action) */}
      {(!pendingConfirmation && !pendingRoute) && activeVehicleId && (
        <View style={styles.marketplaceSection}>
          <View style={{ flexDirection: 'column', paddingHorizontal: 20, marginBottom: 20, gap: 12 }}>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: (route?.status === 'completed' || (route?.stops?.length > 0 && route?.completed_stops >= route?.stops?.length)) ? '#27A150' : '#A9A9A9' }]}
              disabled={!(route?.status === 'completed' || (route?.stops?.length > 0 && route?.completed_stops >= route?.stops?.length))}
              onPress={() => setShowReturnTrip(true)}
            >
              <Text style={styles.primaryButtonText}>{t('find_return')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => setShowCapacityModal(true)}
            >
              <Text style={styles.secondaryButtonText}>{t('declare_load')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </>
  );

  const renderWalletTab = () => (
    <View style={{ flex: 1, paddingHorizontal: 20 }}>
      {/* Earnings Summary Card */}
      <View style={[styles.routeCard, { marginHorizontal: 0, marginTop: 20, backgroundColor: '#111827' }]}>
        <Text style={[styles.routeLabel, { color: '#9CA3AF' }]}>{t('total_earnings')}</Text>
        <Text style={[styles.routeTitle, { color: '#FFFFFF', fontSize: 36, marginTop: 8 }]}>
          ₹{earningsData?.total_earnings?.toLocaleString() || '0'}
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 24, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#374151' }}>
          <View>
            <Text style={[styles.walletLabel, { color: '#9CA3AF' }]}>{t('trips_completed')}</Text>
            <Text style={[styles.walletValue, { color: '#FFFFFF', fontSize: 20 }]}>{earningsData?.completed_trips || 0}</Text>
          </View>
          <View>
            <Text style={[styles.walletLabel, { color: '#9CA3AF' }]}>{t('upcoming_payout')}</Text>
            <Text style={[styles.walletValue, { color: '#FFFFFF', fontSize: 20 }]}>{t('friday')}</Text>
          </View>
        </View>
      </View>

      <Text style={{ color: '#111827', fontSize: 18, fontWeight: '800', marginTop: 16, marginBottom: 12 }}>{t('recent_invoices')}</Text>

      {earningsData?.recent_invoices?.map((inv: any) => (
        <TouchableOpacity
          key={inv.id}
          style={styles.invoiceListItem}
          onPress={() => setSelectedInvoice(inv)}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.invoiceDate}>{new Date(inv.date).toLocaleDateString()} • {inv.cargo_type}</Text>
            <Text style={styles.invoiceRoute} numberOfLines={1}>{inv.pickup} ➔ {inv.drop}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.invoiceAmount}>₹{inv.total_payout.toLocaleString()}</Text>
            <Text style={styles.invoiceStatus}>{t('paid')}</Text>
          </View>
        </TouchableOpacity>
      ))}

      {(!earningsData?.recent_invoices || earningsData.recent_invoices.length === 0) && (
        <View style={styles.noRouteCard}>
          <Text style={styles.noRouteTitle}>{t('no_earnings_yet')}</Text>
          <Text style={styles.noRouteText}>{t('no_earnings_desc')}</Text>
        </View>
      )}

      {/* Invoice Modal */}
      <Modal visible={!!selectedInvoice} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { padding: 0, overflow: 'hidden' }]}>
            {/* Invoice Header */}
            <View style={{ backgroundColor: '#111827', padding: 24, alignItems: 'center' }}>
              <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '900', letterSpacing: 2 }}>{t('invoice_title')}</Text>
              <Text style={{ color: '#9CA3AF', fontSize: 12, marginTop: 4 }}>ID: {selectedInvoice?.id}</Text>
            </View>

            {/* Invoice Body */}
            <View style={{ padding: 24 }}>
              <Text style={{ color: '#6B7280', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 8 }}>{t('trip_details')}</Text>
              <View style={{ marginBottom: 16, gap: 4 }}>
                <Text style={{ color: '#111827', fontSize: 14, fontWeight: '600' }}>{t('pickup_label')}: <Text style={{ fontWeight: '400' }}>{selectedInvoice?.pickup}</Text></Text>
                <Text style={{ color: '#111827', fontSize: 14, fontWeight: '600' }}>{t('drop_label')}: <Text style={{ fontWeight: '400' }}>{selectedInvoice?.drop}</Text></Text>
                <Text style={{ color: '#111827', fontSize: 14, fontWeight: '600' }}>{t('cargo_label')}: <Text style={{ fontWeight: '400' }}>{selectedInvoice?.cargo_type} ({selectedInvoice?.weight_tons} tons)</Text></Text>
                <Text style={{ color: '#111827', fontSize: 14, fontWeight: '600' }}>{t('distance_label')}: <Text style={{ fontWeight: '400' }}>{selectedInvoice?.distance_km} km</Text></Text>
              </View>

              <View style={{ borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#E5E7EB', marginVertical: 16 }} />

              <Text style={{ color: '#6B7280', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 12 }}>{t('earnings_breakdown')}</Text>
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: '#4B5563', fontSize: 14 }}>{t('base_pay')}</Text>
                  <Text style={{ color: '#111827', fontSize: 14, fontWeight: '600' }}>₹{selectedInvoice?.base_pay}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: '#4B5563', fontSize: 14 }}>{t('bonus_label')}</Text>
                  <Text style={{ color: '#27A150', fontSize: 14, fontWeight: '600' }}>+₹{selectedInvoice?.bonus}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: '#4B5563', fontSize: 14 }}>{t('tax_label')}</Text>
                  <Text style={{ color: '#EF4444', fontSize: 14, fontWeight: '600' }}>₹{selectedInvoice?.tax}</Text>
                </View>
              </View>

              <View style={{ borderTopWidth: 2, borderColor: '#111827', marginVertical: 16 }} />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <Text style={{ color: '#111827', fontSize: 18, fontWeight: '900' }}>{t('total_payout')}</Text>
                <Text style={{ color: '#27A150', fontSize: 24, fontWeight: '900' }}>₹{selectedInvoice?.total_payout}</Text>
              </View>

              <TouchableOpacity
                style={[styles.primaryButton, { height: 50, borderRadius: 12 }]}
                onPress={() => setSelectedInvoice(null)}
              >
                <Text style={styles.primaryButtonText}>{t('close')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
  const handleVehicleSelect = async (vehicleType: string) => {
    try {
      await api.updateProfile({ vehicle_type: vehicleType });
      setDriverInfo((prev: any) => ({ ...prev, vehicle_type: vehicleType }));
      Alert.alert('Success', 'Vehicle profile updated!');
    } catch (e: any) {
      Alert.alert(t('error'), e.message);
    }
  };

  const INDIAN_VEHICLES = [
    { id: 'Tata Ace (Chota Hathi)', key: 'veh_tata_ace' },
    { id: 'Mahindra Bolero Pickup', key: 'veh_bolero' },
    { id: 'Ashok Leyland Dost', key: 'veh_dost' },
    { id: 'Ashok Leyland Bada Dost', key: 'veh_bada_dost' },
    { id: 'Maruti Suzuki Super Carry', key: 'veh_super_carry' },
    { id: 'Tata Intra', key: 'veh_intra' },
    { id: 'Tata Yodha', key: 'veh_yodha' },
    { id: 'Mahindra Supro', key: 'veh_supro' },
    { id: 'Piaggio Ape Cargo', key: 'veh_ape' },
    { id: 'Tata 407', key: 'veh_tata_407' },
    { id: 'Eicher Pro 1049 / 2049', key: 'veh_eicher' },
    { id: 'Mahindra Furio 7', key: 'veh_furio' },
    { id: 'Tata 709 / 1109', key: 'veh_tata_709' },
    { id: 'BharatBenz 1015R', key: 'veh_bharatbenz' },
    { id: 'Tata Signa (Multi-axle)', key: 'veh_signa' },
    { id: 'Ashok Leyland U-Truck', key: 'veh_utruck' },
    { id: 'Volvo FM / FMX', key: 'veh_volvo' }
  ];

  const renderProfileTab = () => (
    <View style={styles.routeCard}>

      <View style={{ alignItems: 'center', marginBottom: 24, marginTop: 12 }}>
        <TouchableOpacity onPress={pickImage} style={{ position: 'relative' }}>
          <View style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={{ width: '100%', height: '100%' }} />
            ) : (
              <Ionicons name="person-circle-outline" size={40} color="#9CA3AF" />
            )}
          </View>
          <View style={{ position: 'absolute', bottom: 0, right: 0, backgroundColor: '#FDE047', width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', elevation: 2 }}>
            <Ionicons name="pencil" size={16} color="#451A03" />
          </View>
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16 }}>
          {isEditingName ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TextInput
                style={[styles.routeTitle, { fontSize: 22, color: '#111827', borderBottomWidth: 1, borderColor: '#FDE047', padding: 0, minWidth: 150, textAlign: 'center' }]}
                value={editNameValue}
                onChangeText={setEditNameValue}
                autoFocus
                onSubmitEditing={handleSaveName}
              />
              <TouchableOpacity onPress={handleSaveName} style={{ marginLeft: 12, backgroundColor: '#FDE047', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 }}>
                <Text style={{ fontWeight: 'bold', color: '#451A03' }}>Save</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={[styles.routeTitle, { fontSize: 22, color: '#111827' }]}>
                {driverInfo?.full_name || 'Driver'} {driverInfo?.id ? `(#${driverInfo.id.toString().length > 6 ? driverInfo.id.toString().substring(0, 6).toUpperCase() : driverInfo.id})` : ''}
              </Text>
              <TouchableOpacity onPress={() => { setEditNameValue(driverInfo?.full_name || ''); setIsEditingName(true); }} style={{ marginLeft: 8 }}>
                <Ionicons name="pencil" size={16} color="#451A03" />
              </TouchableOpacity>
            </>
          )}
        </View>
        <Text style={{ color: '#6B7280', fontSize: 16, marginTop: 4, fontWeight: '500' }}>{driverInfo?.phone || '+91 ----------'}</Text>
      </View>

      <View style={{ gap: 16 }}>

        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#686B78', textTransform: 'uppercase', marginBottom: 12 }}>{t('change_language')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <TouchableOpacity onPress={() => setLanguage('en')} style={[styles.langBtn, lang === 'en' && styles.langBtnActive]}><Text style={lang === 'en' ? styles.langTextActive : styles.langText}>English</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setLanguage('hi')} style={[styles.langBtn, lang === 'hi' && styles.langBtnActive]}><Text style={lang === 'hi' ? styles.langTextActive : styles.langText}>हिंदी</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setLanguage('mr')} style={[styles.langBtn, lang === 'mr' && styles.langBtnActive]}><Text style={lang === 'mr' ? styles.langTextActive : styles.langText}>मराठी</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setLanguage('te')} style={[styles.langBtn, lang === 'te' && styles.langBtnActive]}><Text style={lang === 'te' ? styles.langTextActive : styles.langText}>తెలుగు</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setLanguage('kn')} style={[styles.langBtn, lang === 'kn' && styles.langBtnActive]}><Text style={lang === 'kn' ? styles.langTextActive : styles.langText}>ಕನ್ನಡ</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setLanguage('bn')} style={[styles.langBtn, lang === 'bn' && styles.langBtnActive]}><Text style={lang === 'bn' ? styles.langTextActive : styles.langText}>বাংলা</Text></TouchableOpacity>
          </View>
        </View>

        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#686B78', textTransform: 'uppercase', marginBottom: 12 }}>{t('my_vehicle')}</Text>
          <View style={{ gap: 8 }}>
            {INDIAN_VEHICLES.map(v => (
              <TouchableOpacity
                key={v.id}
                onPress={() => handleVehicleSelect(v.id)}
                style={[styles.langBtn, driverInfo?.vehicle_type === v.id && styles.langBtnActive, { minWidth: '100%', alignItems: 'flex-start', paddingVertical: 14 }]}
              >
                <Text style={driverInfo?.vehicle_type === v.id ? styles.langTextActive : styles.langText}>
                  {t(v.key as any) || v.id}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity style={styles.secondaryButton} onPress={handleLogout}>
          <Text style={[styles.secondaryButtonText, { color: '#E23744' }]}>{t('logout')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <LiveRateMarquee />
      {/* Floating Header */}
      <View style={[styles.header, { backgroundColor: '#FDE047', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 50, paddingBottom: 16, zIndex: 10 }]}>
        {/* Left side: Hamburger (placeholder) & Profile Pic (placeholder) */}
        <TouchableOpacity style={{ marginRight: 12 }}>
          <Ionicons name="menu" size={24} color="#451A03" />
        </TouchableOpacity>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', marginRight: 12, overflow: 'hidden' }}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={{ width: '100%', height: '100%' }} />
          ) : (
            <Ionicons name="person-circle-outline" size={20} color="#9CA3AF" />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#451A03', fontSize: 18, fontWeight: 'bold' }}>
            {t('hello_driver')}, {driverInfo?.full_name?.split(' ')[0] || ''} {driverInfo?.id ? `(#${driverInfo.id.toString().length > 6 ? driverInfo.id.toString().substring(0, 6).toUpperCase() : driverInfo.id})` : ''}
          </Text>
          <Text style={{ color: '#451A03', fontSize: 12, opacity: 0.9 }}>{t('my_vehicle')}: {activeVehicle?.plate_number || '---'}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity onPress={() => setShowSosModal(true)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', elevation: 4 }}>
            <Ionicons name="notifications-outline" size={18} color="#111827" />
            <Text style={{ fontSize: 8, color: '#D32F2F', fontWeight: 'bold', marginTop: -4 }}>SOS</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FDE047" />}
      >
        {/* Tracking Toggle (only on route tab) */}
        {activeTab === 'route' && (
          <View style={[styles.trackingCard, isTracking ? styles.trackingActive : styles.trackingInactive]}>
            <View style={styles.trackingInfo}>
              <Text style={styles.trackingTitle}>
                {isTracking ? t('gps_active') : t('gps_paused')}
              </Text>
              <Text style={styles.trackingSubtitle}>
                {isTracking ? `${t('pinging')} ${pingInterval}${t('seconds')}` : t('tap_resume')}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={() => toggleTracking()} style={[styles.trackingToggleBtn, isTracking ? { backgroundColor: '#F2F2F2' } : { backgroundColor: '#27A150' }]}>
                <Text style={{ color: isTracking ? '#686B78' : 'white', fontWeight: 'bold' }}>{isTracking ? t('pause') : t('start')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Tab Content */}
        {activeTab === 'route' && renderRouteTab()}
        {activeTab === 'wallet' && renderWalletTab()}
        {activeTab === 'profile' && renderProfileTab()}
      </ScrollView>

      {showBackhaulPopup && activeVehicleId && (
        <BackhaulPopup vehicleId={activeVehicleId} onDismiss={() => setShowBackhaulPopup(false)} />
      )}

      {/* Zomato-Style Bottom Navigation Bar */}
      <View style={[styles.bottomNav, { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', paddingBottom: 20, paddingTop: 10, borderTopWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFF', position: 'absolute', bottom: 0, left: 0, right: 0 }]}>
        <TouchableOpacity style={{ alignItems: 'center', flex: 1 }} onPress={() => setActiveTab('route')}>
          <Ionicons name="home" size={24} color={activeTab === 'route' ? '#CA8A04' : '#6B7280'} />
          <Text style={{ fontSize: 10, color: activeTab === 'route' ? '#CA8A04' : '#6B7280', fontWeight: 'bold' }}>{t('tab_home')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ alignItems: 'center', flex: 1 }} onPress={() => setActiveTab('wallet')}>
          <MaterialCommunityIcons name="truck-outline" size={24} color={activeTab === 'wallet' ? '#CA8A04' : '#6B7280'} />
          <Text style={{ fontSize: 10, color: activeTab === 'wallet' ? '#CA8A04' : '#6B7280', fontWeight: 'bold' }}>{t('tab_trips')}</Text>
        </TouchableOpacity>

        {/* Floating Scan Button */}
        <View style={{ alignItems: 'center', flex: 1 }}>
          <TouchableOpacity style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: '#FDE047', justifyContent: 'center', alignItems: 'center', marginTop: -30, elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 }}>
            <Ionicons name="camera-outline" size={28} color="#451A03" />
          </TouchableOpacity>
          <Text style={{ fontSize: 10, color: '#6B7280', fontWeight: 'bold', marginTop: 4 }}>{t('tab_scan')}</Text>
        </View>

        <TouchableOpacity style={{ alignItems: 'center', flex: 1 }}>
          <Ionicons name="chatbubble-outline" size={24} color="#6B7280" />
          <Text style={{ fontSize: 10, color: '#6B7280', fontWeight: 'bold' }}>{t('tab_messages')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ alignItems: 'center', flex: 1 }} onPress={() => setActiveTab('profile')}>
          <Ionicons name="person-outline" size={24} color={activeTab === 'profile' ? '#CA8A04' : '#6B7280'} />
          <Text style={{ fontSize: 10, color: activeTab === 'profile' ? '#CA8A04' : '#6B7280', fontWeight: 'bold' }}>{t('tab_profile')}</Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: 100 }} />
      {/* POD Modal */}
      <Modal visible={showPodModal} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('pod_title')}</Text>
            <Text style={styles.modalSubtitle}>{t('pod_desc')}</Text>
            <View style={styles.signatureBox}>
              <TextInput
                style={styles.signatureInput}
                placeholder={t('pod_placeholder')}
                placeholderTextColor="#666666"
                value={signatureData}
                onChangeText={setSignatureData}
              />
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowPodModal(false)}>
                <Text style={styles.modalCancelText}>{t('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSubmitBtn} onPress={submitCompleteStop}>
                <Text style={styles.modalSubmitText}>{t('complete_stop')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* SOS Modal */}
      <Modal visible={showSosModal} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={[styles.modalTitle, { color: '#EF4444' }]}>{t('sos_title')}</Text>
            <Text style={styles.modalSubtitle}>{t('sos_desc')}</Text>

            <View style={{ gap: 14, marginBottom: 24, width: '100%' }}>
              <TouchableOpacity style={{ backgroundColor: '#B91C1C', paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }} onPress={() => handleSOS('accident_serious')}>
                <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: 'bold' }}>{t('sos_acc_serious') || 'Accident - Serious'}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={{ backgroundColor: '#EF4444', paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }} onPress={() => handleSOS('accident_non_serious')}>
                <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: 'bold' }}>{t('sos_acc_minor') || 'Accident - Minor'}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={{ backgroundColor: '#FDE047', paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }} onPress={() => handleSOS('vehicle_damage')}>
                <Text style={{ color: '#451A03', fontSize: 18, fontWeight: 'bold' }}>{t('sos_veh_damage') || 'Vehicle Damage'}</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={[styles.sosInput, { minHeight: 80 }]}
              placeholder={t('sos_details')}
              placeholderTextColor="#999999"
              multiline
              value={sosDescription}
              onChangeText={setSosDescription}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalCancelBtn, { width: '100%', paddingVertical: 14, borderRadius: 12 }]} onPress={() => setShowSosModal(false)}>
                <Text style={styles.modalCancelText}>{t('cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Capacity Modal */}
      <Modal visible={showCapacityModal} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Declare Container Load</Text>
            {activeVehicle ? (
              <Text style={styles.modalSubtitle}>
                Vehicle Type: {activeVehicle.vehicle_type?.toUpperCase() || 'UNKNOWN'}{'\n'}
                Max Capacity: {activeVehicle.capacity_kg} kg{'\n'}
                How much of your capacity is currently loaded?
              </Text>
            ) : (
              <Text style={styles.modalSubtitle}>How full is your vehicle right now?</Text>
            )}

            <View style={{ gap: 12, marginBottom: 24 }}>
              {[0, 25, 50, 75, 100].map(pct => {
                let loadKgStr = '';
                if (activeVehicle?.capacity_kg) {
                  const loadKg = Math.round((pct / 100) * activeVehicle.capacity_kg);
                  loadKgStr = ` (${loadKg} kg)`;
                }
                return (
                  <TouchableOpacity
                    key={pct}
                    style={[styles.modalCancelBtn, { flex: 0 }]}
                    disabled={declaringCapacity}
                    onPress={() => submitCapacity(pct)}
                  >
                    <Text style={[styles.modalCancelText, { color: '#181B26' }]}>
                      {pct === 0 ? `Empty (0%)${loadKgStr}` : pct === 100 ? `Full (100%)${loadKgStr}` : `${pct}% Full${loadKgStr}`}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity style={[styles.modalCancelBtn, { flex: 0 }]} onPress={() => setShowCapacityModal(false)}>
              <Text style={styles.modalCancelText}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showReturnTrip} animationType="slide" presentationStyle="pageSheet">
        {activeVehicleId && (
          <ReturnTripScreen vehicleId={activeVehicleId} onClose={() => setShowReturnTrip(false)} />
        )}
      </Modal>

      {/* Incoming Call Modal */}
      <Modal visible={!!incomingCall} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: '#181B26', borderColor: '#2D3748', alignItems: 'center', paddingVertical: 40 }]}>
            <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: '#27A15022', justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
              <Ionicons name="headset-outline" size={32} color="#000" />
            </View>
            <Text style={[styles.modalTitle, { color: '#FFFFFF', fontSize: 24, marginBottom: 8 }]}>Incoming Call</Text>
            <Text style={[styles.modalSubtitle, { color: '#A0AEC0', fontSize: 16, marginBottom: 40 }]}>{incomingCall?.caller} is calling...</Text>

            <View style={{ flexDirection: 'row', gap: 24, width: '100%', justifyContent: 'center' }}>
              <TouchableOpacity
                style={{ width: 70, height: 70, borderRadius: 35, backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center' }}
                onPress={() => setIncomingCall(null)}
              >
                <Ionicons name="call" size={28} color="white" style={{ transform: [{ rotate: '135deg' }] }} />
              </TouchableOpacity>
              <TouchableOpacity
                style={{ width: 70, height: 70, borderRadius: 35, backgroundColor: '#27A150', justifyContent: 'center', alignItems: 'center' }}
                onPress={() => {
                  setIncomingCall(null);
                  Alert.alert('Call Connected', 'The dispatcher has been notified.');
                }}
              >
                <Ionicons name="call" size={28} color="white" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAF8FF' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 60, paddingBottom: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1, borderBottomColor: '#E0E0E0',
    shadowColor: '#000000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 4
  },
  headerFloating: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
  },
  greeting: { color: '#27A150', fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  driverName: { color: '#111827', fontSize: 26, fontWeight: '900', marginTop: 4 },
  logoutBtn: { backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 2, borderColor: '#E0E0E0' },
  logoutText: { color: '#111827', fontWeight: '800', fontSize: 13, textTransform: 'uppercase' },

  sosTopBtn: { backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 2, borderColor: '#EF4444' },
  sosTopText: { color: '#EF4444', fontWeight: '900', fontSize: 14, letterSpacing: 1 },

  // Tracking card
  trackingCard: {
    marginHorizontal: 20, borderRadius: 16, padding: 24,
    flexDirection: 'row', alignItems: 'center', marginBottom: 20, marginTop: 24,
    borderWidth: 2, backgroundColor: '#FFFFFF',
    shadowColor: '#111827', shadowOpacity: 0.08, shadowRadius: 20, elevation: 8
  },
  trackingActive: { borderColor: '#E0E0E0' },
  trackingInactive: { borderColor: '#E0E0E0', backgroundColor: '#F1F3F5' },
  trackingInfo: { flex: 1 },
  trackingTitle: { color: '#111827', fontWeight: '800', fontSize: 18 },
  trackingSubtitle: { color: '#6B7280', fontSize: 14, marginTop: 4, fontWeight: '500' },
  trackingToggleBtn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12 },

  // Route card
  routeCard: { marginHorizontal: 20, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24, marginBottom: 20, shadowColor: '#111827', shadowOpacity: 0.08, shadowRadius: 20, elevation: 8, marginTop: 20, borderWidth: 1, borderColor: '#E0E0E0' },
  routeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  routeLabel: { color: '#6B7280', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  routeTitle: { color: '#111827', fontSize: 20, fontWeight: '800', marginTop: 4 },

  mapContainer: { width: '100%', height: 380, borderRadius: 16, overflow: 'hidden', marginBottom: 24, position: 'relative', backgroundColor: '#F1F3F5', borderWidth: 2, borderColor: '#E0E0E0' },
  map: { width: '100%', height: '100%' },
  relocateFab: { position: 'absolute', bottom: 120, right: 16, width: 48, height: 48, borderRadius: 24, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', shadowColor: '#000000', shadowOpacity: 0.12, shadowRadius: 15, elevation: 8 },
  speedometerOverlay: { position: 'absolute', top: 100, right: 16, backgroundColor: '#FFFFFF', padding: 12, borderRadius: 12, alignItems: 'center', shadowColor: '#000000', shadowOpacity: 0.1, shadowRadius: 10 },
  speedometerValue: { color: '#111827', fontSize: 24, fontWeight: '900', letterSpacing: -1 },
  speedometerUnit: { color: '#6B7280', fontSize: 10, fontWeight: '800' },

  statusBadge: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  badgeActive: { backgroundColor: '#27A15022', borderWidth: 1, borderColor: '#27A150' },
  badgePending: { backgroundColor: '#F1F3F5', borderWidth: 1, borderColor: '#E0E0E0' },
  statusText: { color: '#111827', fontSize: 12, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase' },

  progressBar: { height: 10, backgroundColor: '#F1F3F5', borderRadius: 5, marginBottom: 8 },
  progressFill: { height: 10, backgroundColor: '#27A150', borderRadius: 5 },

  infoText: { color: '#6B7280', fontSize: 14, fontWeight: '500' },

  nextStopBox: { marginTop: 24, padding: 20, backgroundColor: '#F8F9FA', borderRadius: 12, borderWidth: 2, borderColor: '#E0E0E0' },
  nextStopLabel: { color: '#6B7280', fontSize: 12, fontWeight: '800', letterSpacing: 1.5, marginBottom: 6 },
  nextStopTitle: { color: '#111827', fontSize: 20, fontWeight: '800' },
  nextStopAddress: { color: '#6B7280', fontSize: 14, marginTop: 4 },

  primaryButton: { backgroundColor: '#27A150', borderRadius: 16, height: 60, justifyContent: 'center', alignItems: 'center', shadowColor: '#27A150', shadowOpacity: 0.25, shadowRadius: 10, elevation: 8 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 18, letterSpacing: 1 },
  secondaryButton: { backgroundColor: '#FFFFFF', borderRadius: 16, height: 60, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#E0E0E0' },
  secondaryButtonText: { color: '#111827', fontWeight: '800', fontSize: 16 },

  stopsTitle: { color: '#6B7280', fontSize: 12, fontWeight: '700', marginBottom: 12, letterSpacing: 1, textTransform: 'uppercase' },
  stopItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F2F2F2' },
  stopIcon: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  stopDone: { backgroundColor: '#27A15022', borderWidth: 1, borderColor: '#27A150' },
  stopDoneNew: { backgroundColor: '#27A150', borderWidth: 0, borderColor: '#27A150' },
  stopPending: { backgroundColor: '#F2F3FF', borderWidth: 1, borderColor: '#E8E8E8' },
  stopIconText: { color: '#111827', fontWeight: '700', fontSize: 14 },
  stopIconDone: { color: '#FFFFFF', fontWeight: '800', fontSize: 16 },
  stopInfo: { flex: 1 },
  stopName: { color: '#111827', fontWeight: '700', fontSize: 15 },
  stopAddress: { color: '#6B7280', fontSize: 13, marginTop: 4, fontWeight: '500' },
  deliverBtn: { backgroundColor: '#06B6D4', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  deliverBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },

  noRouteCard: { marginHorizontal: 20, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 40, alignItems: 'center', marginBottom: 40, borderWidth: 1, borderColor: '#E0E0E0', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 5 },
  noRouteIcon: { fontSize: 48, marginBottom: 16 },
  noRouteTitle: { color: '#111827', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  noRouteText: {
    color: '#6B7280',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  completedContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  marketplaceSection: { marginBottom: 20 },

  walletContent: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24 },
  walletItem: { flex: 1 },
  walletLabel: { color: '#6B7280', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  walletValue: { color: '#111827', fontSize: 32, fontWeight: '800', letterSpacing: -1 },

  // Bottom Nav
  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, backgroundColor: '#FFFFFF', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#E0E0E0', paddingBottom: 16, elevation: 20, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 20 },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', height: '100%' },
  navText: { fontSize: 13, color: '#6B7280', fontWeight: '600', letterSpacing: 1 },
  navTextActive: { color: '#27A150', fontWeight: '800' },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: '#FFFFFF', width: '100%', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: '#E0E0E0' },
  modalTitle: { color: '#111827', fontSize: 20, fontWeight: '800', letterSpacing: -0.5, marginBottom: 8 },
  modalSubtitle: { color: '#6B7280', fontSize: 14, marginBottom: 24 },
  signatureBox: { height: 120, backgroundColor: '#FAF8FF', borderRadius: 12, borderWidth: 1, borderColor: '#E8E8E8', marginBottom: 24 },
  signatureInput: { flex: 1, color: '#111827', fontSize: 24, fontWeight: '600', textAlign: 'center' },
  sosInput: { height: 100, backgroundColor: '#FAF8FF', borderRadius: 12, borderWidth: 1, borderColor: '#E8E8E8', marginBottom: 24, padding: 16, color: '#111827', fontSize: 15, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 12 },
  modalCancelBtn: { flex: 1, backgroundColor: '#F8F9FA', paddingVertical: 16, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#E0E0E0' },
  modalCancelText: { color: '#111827', fontWeight: '700', fontSize: 14 },
  modalSubmitBtn: { flex: 1, backgroundColor: '#27A150', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  modalSubmitText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  backhaulActionText: { color: '#111827', fontWeight: '900', fontSize: 14, marginLeft: 6 },

  langBtn: { minWidth: '30%', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 24, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E8E8E8', alignItems: 'center' },
  langBtnActive: { backgroundColor: '#FFF5F6', borderColor: '#E23744' },
  langText: { fontSize: 13, fontWeight: '700', color: '#4F4F4F' },
  langTextActive: { fontSize: 13, fontWeight: '800', color: '#E23744' },

  langToggleGroup: { flexDirection: 'row', backgroundColor: '#F1F3F5', borderRadius: 20, padding: 2 },
  langToggle: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 18 },
  langToggleActive: { backgroundColor: '#E23744' },
  langToggleText: { fontSize: 10, fontWeight: '800', color: '#6B7280' },
  langToggleTextActive: { fontSize: 10, fontWeight: '900', color: '#FFFFFF' },

  invoiceListItem: { backgroundColor: '#FFFFFF', padding: 16, borderRadius: 16, flexDirection: 'row', alignItems: 'center', marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2, borderWidth: 1, borderColor: '#E5E7EB' },
  invoiceDate: { color: '#6B7280', fontSize: 12, fontWeight: '600', marginBottom: 4 },
  invoiceRoute: { color: '#111827', fontSize: 14, fontWeight: '700', paddingRight: 16 },
  invoiceAmount: { color: '#27A150', fontSize: 16, fontWeight: '900' },
  invoiceStatus: { color: '#6B7280', fontSize: 10, fontWeight: '800', marginTop: 4, letterSpacing: 0.5 },
});
