import type { QueryClient } from '@tanstack/react-query'

/** True for any cached query that belongs to this shipment (its page, overview, history, proof, ...). */
const isAboutShipment = (key: readonly unknown[], id: string) => key.includes(id)

/**
 * Stop and forget every query about a shipment that no longer exists, so nothing refetches a 404.
 * Cancels first (a refetch may be in flight), then removes.
 */
export async function dropShipmentQueries(queryClient: QueryClient, id: string) {
  const predicate = (q: { queryKey: readonly unknown[] }) => isAboutShipment(q.queryKey, id)
  await queryClient.cancelQueries({ predicate })
  queryClient.removeQueries({ predicate })
}
