import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CargoState {
  selectedShipmentId: string | null;
  selectedVehicleId: string | null;
  selectedOpportunityId: string | null;
  activeSimulationTab: 'pooling' | 'backhaul' | 'deviation' | 'idle';
}

interface CargoStore extends CargoState {
  setSelectedShipment: (id: string | null) => void;
  setSelectedVehicle: (id: string | null) => void;
  setSelectedOpportunity: (id: string | null) => void;
  setActiveSimulationTab: (tab: CargoState['activeSimulationTab']) => void;
  clearSelection: () => void;
}

const initialState: CargoState = {
  selectedShipmentId: null,
  selectedVehicleId: null,
  selectedOpportunityId: null,
  activeSimulationTab: 'idle',
};

export const useCargoStore = create<CargoStore>()(
  persist(
    (set) => ({
      ...initialState,
      setSelectedShipment: (id) => set({ selectedShipmentId: id }),
      setSelectedVehicle: (id) => set({ selectedVehicleId: id }),
      setSelectedOpportunity: (id) => set({ selectedOpportunityId: id }),
      setActiveSimulationTab: (tab) => set({ activeSimulationTab: tab }),
      clearSelection: () => set({ ...initialState }),
    }),
    {
      name: 'cargo-network-storage',
      partialize: (state) => ({ 
        selectedShipmentId: state.selectedShipmentId,
        selectedVehicleId: state.selectedVehicleId
      }),
    }
  )
);
