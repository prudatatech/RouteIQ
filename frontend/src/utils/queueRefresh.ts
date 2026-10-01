import type { QueryClient, QueryKey } from '@tanstack/react-query'

/** The shared counts query: the sidebar badges and the Today queues read the same one. */
export const QUEUE_COUNT_KEYS: QueryKey[] = [['ops-today'], ['tpl-pending-partners']]

/** Everything an assign, send, take-off or accept can move: the lists on Dispatch, the fleet and the cases. */
export const DISPATCH_KEYS: QueryKey[] = [
  ['shipments'], ['routes'], ['route'], ['vehicles'], ['fleet-summary'], ['customer-bookings'], ['vendor-requests'], ['assign-options'], ['cargo'],
]

/** How long after a change the counts are read a second time, in case the first read ran before the server committed. */
export const SECOND_REFRESH_MS = 1500

/**
 * Read the queue counts again now and once more shortly after. Changes made outside react-query
 * (a plain API call in a modal) and a read that races the server's commit both leave a stale count;
 * the second read catches them.
 */
export function refreshQueueCounts(queryClient: QueryClient, delayMs = SECOND_REFRESH_MS) {
  const run = () => { for (const queryKey of QUEUE_COUNT_KEYS) void queryClient.invalidateQueries({ queryKey }) }
  run()
  setTimeout(run, delayMs)
}

/** After an assign, send, take-off or accept: the lists they touch and the counts, with the counts read twice. */
export function refreshAfterDispatchChange(queryClient: QueryClient, delayMs = SECOND_REFRESH_MS) {
  for (const queryKey of DISPATCH_KEYS) void queryClient.invalidateQueries({ queryKey })
  refreshQueueCounts(queryClient, delayMs)
}
