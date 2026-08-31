import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface DraftShipmentData {
  tracking_id: string;
  originSearch: string;
  destSearch: string;
  searchTerm: string;
  mobilePhone: string;
  selectedVehicleId: string;
  origin_id: string;
  origin_name: string;
  origin_address: string;
  origin_lat: number;
  origin_lng: number;
  delivery_point_id: string;
  delivery_point_name: string;
  delivery_point_address: string;
  dest_lat: number;
  dest_lng: number;
  stops: Array<{
    id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
  }>;
  priority: string;
  cargo_type: string;
  total_items: number;
  total_weight_kg: number;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  plan_for_later: boolean;
  enable_mobile_gps: boolean;
  scheduled_date: string;
  scheduled_time: string;
  open_bidding: boolean;
  bidding_opens_at: string;
  bidding_closes_at: string;
  bidding_duration_mins?: number;
  asking_price?: string;
}

const initialDraftData: DraftShipmentData = {
  tracking_id: `RTX-${Math.random().toString(36).substring(2, 9).toUpperCase()}`,
  originSearch: '',
  destSearch: '',
  searchTerm: '',
  mobilePhone: '',
  selectedVehicleId: '',
  origin_id: '',
  origin_name: '',
  origin_address: '',
  origin_lat: 0,
  origin_lng: 0,
  delivery_point_id: '',
  delivery_point_name: '',
  delivery_point_address: '',
  dest_lat: 0,
  dest_lng: 0,
  stops: [],
  priority: 'medium',
  cargo_type: 'standard',
  total_items: 1,
  total_weight_kg: 5.0,
  length_cm: 50,
  width_cm: 50,
  height_cm: 50,
  plan_for_later: false,
  enable_mobile_gps: false,
  scheduled_date: '',
  scheduled_time: '',
  open_bidding: false,
  bidding_opens_at: '',
  bidding_closes_at: ''
};

interface DraftStore {
  isModalOpen: boolean;
  isMinimized: boolean;
  formData: DraftShipmentData;
  openModal: () => void;
  closeModal: () => void;
  minimizeModal: () => void;
  expandModal: () => void;
  setFormData: (data: Partial<DraftShipmentData> | ((prev: DraftShipmentData) => DraftShipmentData)) => void;
  clearDraft: () => void;
}

export const useDraftStore = create<DraftStore>()(
  persist(
    (set) => ({
      isModalOpen: false,
      isMinimized: false,
      formData: { ...initialDraftData, tracking_id: `RTX-${Math.random().toString(36).substring(2, 9).toUpperCase()}` },
      openModal: () => set({ isModalOpen: true, isMinimized: false }),
      closeModal: () => set({ isModalOpen: false }),
      minimizeModal: () => set({ isMinimized: true }),
      expandModal: () => set({ isMinimized: false }),
      setFormData: (updater) => set((state) => ({
        formData: typeof updater === 'function' ? updater(state.formData) : { ...state.formData, ...updater }
      })),
      clearDraft: () => set({ 
        formData: { ...initialDraftData, tracking_id: `RTX-${Math.random().toString(36).substring(2, 9).toUpperCase()}` },
        isModalOpen: false,
        isMinimized: false
      }),
    }),
    {
      name: 'draft-shipment-storage',
      // We only want to persist formData and isMinimized, not isModalOpen (so if they refresh, it's not popping up full screen)
      partialize: (state) => ({ formData: state.formData, isMinimized: state.isMinimized }),
    }
  )
);
