import { useQuery } from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import { cargoAPI, vehiclesAPI } from '@/services/api'

/** A created shipment that is not on a route yet (GET /cargo/open-loads). */
export interface OpenLoad {
  id: string
  tracking_id: string
  status: string
  priority: string | null
  shipper: string | null
  origin: string | null
  origin_lat: number | null
  origin_lng: number | null
  destination: string | null
  dest_lat: number | null
  dest_lng: number | null
  stops: number
  weight_kg: number | null
  created_at: string
}

export interface BackhaulVehicle {
  id: string
  plate_number: string
  status: string | null
  vehicle_type?: string | null
  capacity_kg: number | null
  available_capacity_kg?: number | null
}

/** The route or manifest handed over by Route details → Duplicate. */
export interface DuplicatedManifest {
  id: string
  vehicle_id?: string | null
  vehicles?: { plate_number?: string | null } | null
  route_stops?: { sequence: number; delivery_points?: { name?: string | null; address?: string | null } | null }[]
}

export const backhaulKeys = {
  openLoads: ['backhaul', 'open-loads'] as const,
  vehicles: ['vehicles', 'backhaul-list'] as const,
}

export function useOpenLoads() {
  return useQuery<OpenLoad[]>({
    queryKey: backhaulKeys.openLoads,
    queryFn: () => cargoAPI.openLoads() as Promise<OpenLoad[]>,
    refetchInterval: 60_000,
  })
}

export function useBackhaulVehicles() {
  return useQuery<BackhaulVehicle[]>({
    queryKey: backhaulKeys.vehicles,
    queryFn: () => vehiclesAPI.list({ limit: 200 }) as Promise<BackhaulVehicle[]>,
    select: rows => rows.filter(v => v.status !== 'archived'),
  })
}

/** Readable message from an API error, falling back to `fallback`. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const detail = (err as AxiosError<{ detail?: unknown }>)?.response?.data?.detail
  return typeof detail === 'string' && detail ? detail : fallback
}


/** Space a vehicle can still take, preferring the live figure. */
export const spaceLeft = (v: BackhaulVehicle) => v.available_capacity_kg ?? v.capacity_kg ?? null

export const vehicleLabel = (v: BackhaulVehicle) =>
  `${v.plate_number}${v.capacity_kg ? ` · ${v.capacity_kg.toLocaleString('en-IN')} kg` : ' · no capacity recorded'}`
