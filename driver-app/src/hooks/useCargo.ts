/**
 * Cargo data for the driver's screens: what is on the vehicle, the transfers
 * the vehicle is part of, and one consignment's details. Each keeps its last
 * good answer on the phone, so the cargo check after an accident still works
 * with no signal.
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../services/api';
import {
  cacheInfo,
  readCachedInfo,
  readConsignmentInfo,
  readLotFamily,
  readOnBoard,
  readTransfers,
  type CargoTransfer,
  type ConsignmentInfo,
  type LotFamily,
  type OnBoardItem,
} from '../services/cargo';

// v3: items carry the server's lot (label, master) and consignee name
const ON_BOARD_KEY = 'cargo_on_board_v3';
const TRANSFERS_KEY = 'cargo_transfers_v2';
// v2: lots carry their seq and split reason
const LOTS_KEY = 'cargo_lots_v2';

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

/** Details of several consignments at once (the lots at one drop), each from the server or the phone's copy. */
export function useConsignmentInfos(codes: string[]) {
  const joined = codes.join('|');
  const [infos, setInfos] = useState<Record<string, ConsignmentInfo | null>>({});
  const [loading, setLoading] = useState(codes.length > 0);

  useEffect(() => {
    let alive = true;
    const list = joined ? joined.split('|') : [];
    setLoading(list.length > 0);
    Promise.all(
      list.map(async (code): Promise<[string, ConsignmentInfo | null]> => {
        const cached = await readCachedInfo(code);
        // The phone's copy shows at once; the server's answer replaces it when it comes
        if (cached && alive) setInfos((cur) => (code in cur ? cur : { ...cur, [code]: cached }));
        try {
          const fresh = readConsignmentInfo(await api.getCargoWhere(code));
          cacheInfo(code, fresh);
          return [code, fresh];
        } catch {
          return [code, cached];
        }
      }),
    ).then((entries) => {
      if (!alive) return;
      setInfos((cur) => ({ ...cur, ...Object.fromEntries(entries.filter(([, value]) => value !== null)) }));
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [joined]);

  return { infos, loading };
}

/**
 * The lots of a split consignment (GET /cargo/lots/:ref), by any lot's code or the master's. The
 * last answer is kept on the phone per code. `family` is null for a consignment that was never
 * split (the server answers no lots, or 404).
 */
export function useLotFamily(code: string | null | undefined) {
  const result = useCachedQuery<LotFamily | null>(
    `${LOTS_KEY}:${code ?? ''}`,
    ['cargoLots', code],
    async () => {
      try {
        return readLotFamily(await api.getCargoLots(code!));
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    !!code,
  );
  const family = result.data && result.data.lots.length > 0 ? result.data : null;
  return { ...result, family };
}
