import { point, lineString, nearestPointOnLine, lineSlice, length, along } from '@turf/turf';
import type { Feature, LineString } from 'geojson';

interface AnimationOptions {
  startCoord: [number, number];
  endCoord: [number, number];
  /** Road geometry ([lng, lat] pairs). When both ends lie on it, the marker follows the road. */
  routeCoords?: [number, number][];
  duration?: number; // milliseconds
  onTick: (coord: [number, number]) => void;
  onComplete?: () => void;
}

/** A point further than this from the route is treated as off-route (straight-line move). */
const MAX_SNAP_KM = 0.05;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Moves a marker from startCoord to endCoord over `duration` ms, along the route
 * when both ends are on it, otherwise in a straight line. Calls onTick every frame.
 * Returns a function that cancels the animation.
 */
export function animateMarkerAlongRoute({
  startCoord,
  endCoord,
  routeCoords,
  duration = 2000,
  onTick,
  onComplete
}: AnimationOptions): () => void {
  let isCancelled = false;
  let frameId: number | null = null;
  let startTime: number | null = null;
  let animationPath: Feature<LineString> | null = null;
  let pathLength = 0;

  if (prefersReducedMotion() || duration <= 0) {
    onTick(endCoord);
    onComplete?.();
    return () => {};
  }

  // 1. Prepare the path geometry
  if (routeCoords && routeCoords.length > 1) {
    try {
      const fullRoute = lineString(routeCoords);
      const snappedA = nearestPointOnLine(fullRoute, point(startCoord), { units: 'kilometers' });
      const snappedB = nearestPointOnLine(fullRoute, point(endCoord), { units: 'kilometers' });

      // Only follow the road when both ends are actually on it; otherwise the
      // marker would slide to the road and then jump back to the real position.
      if (snappedA.properties.pointDistance <= MAX_SNAP_KM && snappedB.properties.pointDistance <= MAX_SNAP_KM) {
        const sliced = lineSlice(snappedA, snappedB, fullRoute);
        pathLength = length(sliced, { units: 'kilometers' });
        if (pathLength > 0.0001) {
          animationPath = sliced;
        }
      }
    } catch (e) {
      console.warn('Route slicing failed, moving in a straight line instead', e);
    }
  }

  // 2. Animation loop
  function frame(timestamp: number) {
    if (isCancelled) return;
    if (startTime === null) startTime = timestamp;

    const progress = Math.min((timestamp - startTime) / duration, 1);

    if (animationPath) {
      const currentPoint = along(animationPath, progress * pathLength, { units: 'kilometers' });
      onTick(currentPoint.geometry.coordinates as [number, number]);
    } else {
      onTick([
        startCoord[0] + (endCoord[0] - startCoord[0]) * progress,
        startCoord[1] + (endCoord[1] - startCoord[1]) * progress,
      ]);
    }

    if (progress < 1) {
      frameId = requestAnimationFrame(frame);
    } else {
      // Snap to the exact end coordinates to avoid floating point overshoot
      onTick(endCoord);
      onComplete?.();
    }
  }

  frameId = requestAnimationFrame(frame);

  // Cancel when the component unmounts or a newer position arrives
  return () => {
    isCancelled = true;
    if (frameId !== null) cancelAnimationFrame(frameId);
  };
}
