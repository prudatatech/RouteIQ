/**
 * Cargo data for the driver's screens: what is on the vehicle, the transfers
 * the vehicle is part of, and one consignment's details. Each keeps its last
 * good answer on the phone, so the cargo check after an accident still works
 * with no signal.
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import {
  cacheInfo,
  readCachedInfo,
  readConsignmentInfo,
  readOnBoard,
  readTransfers,
  type CargoTransfer,
  type ConsignmentInfo,
  type OnBoardItem,
} from '../services/cargo';

const ON_BOARD_KEY = 'cargo_on_board_v1';
const TRANSFERS_KEY = 'cargo_transfers_v1';

async function readJson<T>(key: string): Promise<T | undefined> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** A query whose last answer is kept on the phone and shown until a new one arrives. */
function useCachedQuery<T>(key: string, queryKey: unknown[], fetcher: () => Promise<T>, enabled: boolean) {
  const [cached, setCached] = useState<T | undefined>(undefined);
  useEffect(() => {
    readJson<T>(key).then((value) => value !== undefined && setCached(value));
  }, [key]);

  const query = useQuery({
    queryKey,
    enabled,
    staleTime: 15_000,
    retry: 1,
    queryFn: async () => {
      const value = await fetcher();
      AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});
      return value;
    },
  });
  return {
    data: query.data ?? cached,
    /** Shown from the phone's copy because the server could not be reached. */
    stale: !query.data && query.isError,
    error: query.error,
    loading: query.isLoading && cached === undefined,
    refetch: query.refetch,
  };
}

/** Consignments on the driver's vehicle (GET /cargo/driver/on-board). */
export function useOnBoard(enabled: boolean) {
  const result = useCachedQuery<OnBoardItem[]>(ON_BOARD_KEY, ['cargoOnBoard'], async () => readOnBoard(await api.getCargoOnBoard()), enabled);
  return { ...result, items: result.data ?? [] };
}

export interface VehicleTransfer {
  transfer: CargoTransfer;
  /** 'out': this vehicle hands the goods over; 'in': it receives them. */
  direction: 'out' | 'in';
}

/** Planned and running transfers this vehicle hands over or receives. */
export function useCargoTransfers(vehicleId: string | null) {
  const result = useCachedQuery<CargoTransfer[]>(
    TRANSFERS_KEY,
    ['cargoTransfers', vehicleId],
    async () => {
      const [planned, running] = await Promise.all([api.getCargoTransfers('planned'), api.getCargoTransfers('in_progress')]);
      return [...readTransfers(planned), ...readTransfers(running)];
    },
    !!vehicleId,
  );
  const transfers: VehicleTransfer[] = (result.data ?? []).flatMap((transfer): VehicleTransfer[] => {
    if (transfer.status !== 'planned' && transfer.status !== 'in_progress') return [];
    if (transfer.fromVehicleId === vehicleId) return [{ transfer, direction: 'out' }];
    if (transfer.toVehicleId === vehicleId) return [{ transfer, direction: 'in' }];
    return [];
  });
  return { ...result, transfers };
}

/** One consignment's details by parcel code: from the server when online, else the phone's last copy. */
export function useConsignmentInfo(code: string | null | undefined) {
  const [info, setInfo] = useState<ConsignmentInfo | null>(null);
  const [loading, setLoading] = useState(!!code);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    if (!code) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const cached = await readCachedInfo(code);
    if (cached) setInfo(cached);
    try {
      const fresh = readConsignmentInfo(await api.getCargoWhere(code));
      setInfo(fresh);
      setOffline(false);
      cacheInfo(code, fresh);
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);

  return { info, loading, offline, reload: load };
}
