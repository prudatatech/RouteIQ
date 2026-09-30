import { useQuery } from '@tanstack/react-query'
import { cargoKeys, custodyAPI, type OnBoard, type OnBoardItem } from '@/services/cargo'

/** GET /cargo/vehicles/:id/on-board, shared by the vehicle page, the SOS panel and the maintenance modal. */
export function useOnBoard(vehicleId: string | null | undefined, opts: { enabled?: boolean; refetchInterval?: number } = {}) {
  return useQuery<OnBoard>({
    queryKey: cargoKeys.onBoard(vehicleId ?? ''),
    queryFn: () => custodyAPI.onBoard(vehicleId!),
    enabled: !!vehicleId && (opts.enabled ?? true),
    refetchInterval: opts.refetchInterval,
  })
}

export function onBoardTotals(items: OnBoardItem[]) {
  return {
    consignments: items.length,
    pieces: items.reduce((n, i) => n + (i.pieces_on_board ?? 0), 0),
    weightKg: items.reduce((n, i) => n + (Number(i.weight_kg) || 0), 0),
  }
}
