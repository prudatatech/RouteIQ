import { useQuery } from '@tanstack/react-query'
import { financeAPI } from '@/services/api'

export interface FinanceSummary {
  range: { from: string; to: string }
  revenue: number
  gst_collected: number
  outstanding: number
  invoice_count: number
  costs: {
    total: number
    recorded: number
    fuel_estimated: number
    by_category: { category: string; label: string; amount: number; estimated: boolean }[]
  }
  net_profit: number
  active_trucks: number
  profit_per_truck: number | null
  distance_km: number
  cost_per_km: number | null
  fuel: {
    price_per_litre: number | null
    price_missing: boolean
    routes_covered_by_expenses: number
    routes_without_fuel_data: number
  }
  daily: { date: string; revenue: number; costs: number; profit: number }[]
  vehicles: { vehicle_id: string; plate_number: string; revenue: number; costs: number; profit: number }[]
  routes: {
    route_id: string
    plate_number: string | null
    completed_at: string | null
    distance_km: number | null
    revenue: number
    costs: number
    profit: number
    fuel_estimated: boolean
  }[]
  corridors: { pickup: string; drop: string; revenue: number; loads: number }[]
}

/** Profit and loss for an IST date range; shared by the Overview tiles and the Finance tab. */
export function useFinanceSummary(range: { from: string; to: string }) {
  return useQuery<FinanceSummary>({
    queryKey: ['finance', 'summary', range.from, range.to],
    queryFn: () => financeAPI.summary({ from: range.from, to: range.to }) as Promise<FinanceSummary>,
    refetchInterval: 60_000,
  })
}
