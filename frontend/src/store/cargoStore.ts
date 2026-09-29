import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Selections on the Backhaul pooling page that should survive switching tabs
 * and reloads: the truck being planned for and the load being matched.
 * Stale ids (a vehicle deleted, a load already routed) are ignored by the page.
 */
export interface CargoState {
  selectedShipmentId: string | null;
  selectedVehicleId: string | null;
}

interface CargoStore extends CargoState {
  setSelectedShipment: (id: string | null) => void;
  setSelectedVehicle: (id: string | null) => void;
  clearSelection: () => void;
}

const initialState: CargoState = {
  selectedShipmentId: null,
  selectedVehicleId: null,
};

export const useCargoStore = create<CargoStore>()(
  persist(
    (set) => ({
      ...initialState,
      setSelectedShipment: (id) => set({ selectedShipmentId: id }),
      setSelectedVehicle: (id) => set({ selectedVehicleId: id }),
      clearSelection: () => set({ ...initialState }),
    }),
    {
      name: 'cargo-network-storage',
      partialize: (state) => ({
        selectedShipmentId: state.selectedShipmentId,
        selectedVehicleId: state.selectedVehicleId,
      }),
    }
  )
);
