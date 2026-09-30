/**
 * Road-following line from the driver's position through the remaining stops,
 * with the remaining distance and duration, from the public OSRM router.
 * Falls back to straight segments when OSRM is unavailable.
 */
import { useEffect, useMemo, useState } from 'react';
import type { LatLng, MyRouteResponse } from '../types/route';
import { pendingStops, stopCoord, sortedStops } from '../utils/route';

export interface MapPoint {
  latitude: number;
  longitude: number;
}

/** The public OSRM server accepts at most this many waypoints. */
const MAX_WAYPOINTS = 20;

export function useSnappedRoute(routeData: MyRouteResponse | null, currentLoc: LatLng | null) {
  const [line, setLine] = useState<MapPoint[]>([]);
  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [durationS, setDurationS] = useState<number | null>(null);

  const route = routeData?.active ? routeData.route : undefined;
  // Only recompute when the set of pending stops changes, or once a location is known.
  const signature = useMemo(() => JSON.stringify(pendingStops(route).map((s) => s.id)), [route]);
  const hasLoc = !!currentLoc;

  useEffect(() => {
    if (!route) {
      setLine([]);
      setDistanceM(null);
      setDurationS(null);
      return;
    }

    const stops: MapPoint[] = pendingStops(route)
      .map(stopCoord)
      .filter((c): c is LatLng => !!c)
      .map((c) => ({ latitude: c.lat, longitude: c.lng }));

    const originLoc = currentLoc || stopCoord(sortedStops(route)[0]);
    const waypoints =
      originLoc && stops.length > 0 ? [{ latitude: originLoc.lat, longitude: originLoc.lng }, ...stops] : stops;

    if (waypoints.length < 2) {
      setLine(waypoints);
      setDistanceM(null);
      setDurationS(null);
      return;
    }

    const safeWaypoints = waypoints.slice(0, MAX_WAYPOINTS);
    const coordinates = safeWaypoints.map((wp) => `${wp.longitude},${wp.latitude}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`;
    let cancelled = false;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const best = data?.routes?.[0];
        if (best) {
          setLine(best.geometry.coordinates.map((c: number[]) => ({ latitude: c[1], longitude: c[0] })));
          setDistanceM(best.distance);
          setDurationS(best.duration);
        } else {
          setLine(safeWaypoints);
          setDistanceM(null);
          setDurationS(null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('OSRM fetch failed:', err);
        setLine(safeWaypoints);
        setDistanceM(null);
        setDurationS(null);
      });

    return () => {
      cancelled = true;
    };
    // Recompute on route/stop changes and when a location first becomes known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.id, signature, hasLoc]);

  return { line, distanceM, durationS };
}
