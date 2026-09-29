import { Linking } from 'react-native';
import type { DriverRoute, LatLng } from '../types/route';
import { pendingStops, pointCoord, stopCoord, stopCounts } from './route';

/**
 * Opens turn-by-turn navigation to one point: the Google Maps app when it is
 * installed, otherwise Google Maps in the browser. Resolves false if neither
 * could be opened.
 */
export async function openTurnByTurn(target: LatLng): Promise<boolean> {
  const appUrl = `google.navigation:q=${target.lat},${target.lng}`;
  try {
    if (await Linking.canOpenURL(appUrl)) {
      await Linking.openURL(appUrl);
    } else {
      await Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Google Maps directions through every remaining stop. Before any stop is
 * done the depot comes first (that is where the cargo is loaded).
 * Returns null when no remaining stop has a location.
 */
export function fullRouteUrl(route: DriverRoute): string | null {
  const points: LatLng[] = [];
  const depot = pointCoord(route.depot);
  if (depot && stopCounts(route).done === 0) points.push(depot);
  for (const stop of pendingStops(route)) {
    const c = stopCoord(stop);
    if (c) points.push(c);
  }
  if (points.length === 0) return null;

  const destination = points[points.length - 1];
  let url = `https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}`;
  const waypoints = points.slice(0, -1);
  if (waypoints.length > 0) {
    url += `&waypoints=${waypoints.map((p) => `${p.lat},${p.lng}`).join('%7C')}`;
  }
  return url;
}
