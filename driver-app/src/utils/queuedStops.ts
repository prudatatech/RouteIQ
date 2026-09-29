import type { QueuedAction } from '../services/actionQueue';
import type { MyRouteResponse, RouteStop } from '../types/route';

/**
 * The route as the driver has left it: stops completed or failed while offline
 * count as done straight away, even though the server has not heard yet. Once
 * the queue is sent and the route refreshed, the server's own state agrees.
 */
export function withQueuedStops(data: MyRouteResponse | null, queued: readonly QueuedAction[]): MyRouteResponse | null {
  if (!data?.route?.stops?.length || queued.length === 0) return data;

  const outcome = new Map<string, 'completed' | 'failed'>();
  for (const a of queued) {
    if (a.kind === 'complete_stop') outcome.set(a.payload.stopId, 'completed');
    else if (a.kind === 'fail_stop') outcome.set(a.payload.stopId, 'failed');
  }
  if (outcome.size === 0) return data;

  let changed = false;
  const stops: RouteStop[] = data.route.stops.map((s) => {
    const next = outcome.get(s.id);
    if (!next || s.status !== 'pending') return s;
    changed = true;
    return { ...s, status: next };
  });
  if (!changed) return data;

  const completed = stops.filter((s) => s.status === 'completed').length;
  const pending = stops.filter((s) => s.status === 'pending').length;
  return {
    ...data,
    route: {
      ...data.route,
      stops,
      completed_stops: completed,
      remaining_stops: pending,
      progress_pct: Math.round((completed / stops.length) * 100),
      status: pending === 0 ? 'completed' : data.route.status,
    },
  };
}
