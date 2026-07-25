import { point, lineString, nearestPointOnLine, lineSlice, length, along } from '@turf/turf';

interface AnimationOptions {
  startCoord: [number, number];
  endCoord: [number, number];
  routeCoords?: [number, number][];
  duration?: number; // milliseconds
  onTick: (coord: [number, number]) => void;
  onComplete?: () => void;
}

export function animateMarkerAlongRoute({
  startCoord,
  endCoord,
  routeCoords,
  duration = 2000,
  onTick,
  onComplete
}: AnimationOptions): () => void {
  let isCancelled = false;
  let startTime: number | null = null;
  let animationPath: any = null;
  let pathLength = 0;

  // 1. Prepare the path geometry
  if (routeCoords && routeCoords.length > 1) {
    try {
      const fullRoute = lineString(routeCoords);
      const ptA = point(startCoord);
      const ptB = point(endCoord);
      
      const snappedA = nearestPointOnLine(fullRoute, ptA);
      const snappedB = nearestPointOnLine(fullRoute, ptB);
      
      const sliced = lineSlice(snappedA, snappedB, fullRoute);
      pathLength = length(sliced, { units: 'kilometers' });

      // If the points are identical or snap to the exact same spot on the route, fallback
      if (pathLength > 0.0001) {
        animationPath = sliced;
      }
    } catch (e) {
      console.warn("Turf slicing failed, falling back to straight-line interpolation", e);
    }
  }

  // 2. Animation loop
  function frame(timestamp: number) {
    if (isCancelled) return;
    if (!startTime) startTime = timestamp;

    const elapsed = timestamp - startTime;
    const progress = Math.min(elapsed / duration, 1);

    if (animationPath) {
      // Curved interpolation along route
      const distance = progress * pathLength;
      const currentPoint = along(animationPath, distance, { units: 'kilometers' });
      onTick(currentPoint.geometry.coordinates as [number, number]);
    } else {
      // Straight-line interpolation fallback
      const currentLng = startCoord[0] + (endCoord[0] - startCoord[0]) * progress;
      const currentLat = startCoord[1] + (endCoord[1] - startCoord[1]) * progress;
      onTick([currentLng, currentLat]);
    }

    if (progress < 1) {
      requestAnimationFrame(frame);
    } else {
      // Snap to exact end coordinates to avoid floating point overshoot
      onTick(endCoord);
      if (onComplete) onComplete();
    }
  }

  requestAnimationFrame(frame);

  // Return a cancellation function in case the component unmounts or a new ping arrives
  return () => {
    isCancelled = true;
  };
}
