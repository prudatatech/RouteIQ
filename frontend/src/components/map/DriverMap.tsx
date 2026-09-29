import { useEffect, useMemo, useRef, useState } from 'react';
import MapView from './MapView';
import { fetchDrivingRoute, type DrivingRoute } from './directions';
import type { LatLng, MapPoint, MapRoute, MapVehicle } from './types';
import { formatMinutes } from '@/utils/display'

interface DriverMapProps {
  currentLat: number;
  currentLng: number;
  targetLat: number;
  targetLng: number;
  shiftStatus: string;
  speed?: number;
}

/** Refresh the road route at most this often while driving. */
const ROUTE_REFRESH_MS = 10000;

/** Driver navigation: the driver's position, the next stop and the road route between them. */
export default function DriverMap({ currentLat, currentLng, targetLat, targetLng, shiftStatus, speed = 0 }: DriverMapProps) {
  const onMission = shiftStatus === 'ON_MISSION';
  const hasTarget = targetLat !== currentLat || targetLng !== currentLng;
  const [driving, setDriving] = useState<DrivingRoute | null>(null);

  const current = useRef<LatLng>({ lat: currentLat, lng: currentLng });
  current.current = { lat: currentLat, lng: currentLng };

  // Road route: fetched when the destination changes, then refreshed every 10 s
  // from the latest position (not on every GPS update).
  useEffect(() => {
    setDriving(null);
    if (!hasTarget) return;
    let controller = new AbortController();
    const load = () => {
      controller.abort();
      controller = new AbortController();
      const signal = controller.signal;
      fetchDrivingRoute([current.current, { lat: targetLat, lng: targetLng }], signal)
        .then((result) => { if (!signal.aborted) setDriving(result); })
        .catch((err: unknown) => { if (!signal.aborted) console.warn('Could not fetch directions', err); });
    };
    load();
    const timer = window.setInterval(load, ROUTE_REFRESH_MS);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [targetLat, targetLng, hasTarget]);

  const vehicles = useMemo<MapVehicle[]>(() => [{
    id: 'driver',
    position: { lat: currentLat, lng: currentLng },
    status: onMission ? 'on_route' : 'available',
    label: 'You',
  }], [currentLat, currentLng, onMission]);

  const points = useMemo<MapPoint[]>(() => hasTarget
    ? [{ id: 'destination', kind: 'drop', position: { lat: targetLat, lng: targetLng }, label: 'Next stop' }]
    : [], [hasTarget, targetLat, targetLng]);

  const route = useMemo<MapRoute | null>(() => {
    if (!hasTarget) return null;
    if (driving) return { coordinates: driving.coordinates };
    return { coordinates: [[currentLng, currentLat], [targetLng, targetLat]], planned: true };
  }, [hasTarget, driving, currentLat, currentLng, targetLat, targetLng]);

  const stats = [
    { label: 'Arrives in', value: driving ? formatMinutes(driving.durationSeconds / 60) : 'Not available' },
    { label: 'Distance left', value: driving ? `${(driving.distanceMeters / 1000).toFixed(1)} km` : 'Not available' },
    { label: 'Speed', value: `${Math.round(onMission ? speed : 0)} km/h` },
  ];

  return (
    <div className="relative flex h-[calc(100vh-100px)] flex-col">
      <div className="relative flex-1 overflow-hidden rounded-card border border-border bg-surface">
        <MapView
          mode="tracking"
          vehicles={vehicles}
          points={points}
          route={route}
          follow={onMission}
          pitch={60}
          fitPadding={{ top: 48, left: 48, right: 64, bottom: 200 }}
          initialCenter={{ lat: currentLat, lng: currentLng }}
          initialZoom={14}
          showLabels
          ariaLabel="Navigation map"
        >
          <section
            aria-label="Route to next stop"
            className="absolute inset-x-3 bottom-3 z-10 rounded-card border border-border bg-surface p-4 shadow-raised"
          >
            <h2 className="text-lg font-semibold text-text">Route to next stop</h2>
            <dl className="mt-3 grid grid-cols-3 gap-3">
              {stats.map((s) => (
                <div key={s.label} className="rounded-control bg-surface-subtle p-3">
                  <dt className="text-xs text-muted">{s.label}</dt>
                  <dd className="tabular text-sm font-medium text-text">{s.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </MapView>
      </div>
    </div>
  );
}
