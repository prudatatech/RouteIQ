import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Search, Truck, X, Fuel, Info, AlertCircle, MapPin,
  BarChart2, Settings, Cloud, Thermometer, Pencil, Trash2,
  ChevronDown, ExternalLink, Copy, CheckCircle2, Navigation
} from 'lucide-react'
import { vehiclesAPI } from '@/services/api'
import { Card, StatusDot, Button, Spinner } from '@/components/ui'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'
import clsx from 'clsx'

const STATUS_OPTIONS = ['all', 'on_route', 'available', 'idle', 'maintenance', 'offline']
const VEHICLE_TYPES = ['truck', 'van', 'bike', 'car']
const FUEL_TYPES = ['diesel', 'petrol', 'electric', 'cng']
const STATUS_OPTS = ['available', 'on_route', 'idle', 'maintenance', 'offline']

// Indian Truck Presets — standard models with capacity + container dimensions
const INDIAN_TRUCK_PRESETS: Record<string, { capacity_kg: number; container_length_ft: number; container_width_ft: number; container_height_ft: number; fuel_type: string; fuel_capacity_liters: number; fuel_efficiency_kmpl: number }> = {
  'Tata Ace (Chota Hathi)': { capacity_kg: 750, container_length_ft: 7, container_width_ft: 4.5, container_height_ft: 4.5, fuel_type: 'diesel', fuel_capacity_liters: 30, fuel_efficiency_kmpl: 18 },
  'Mahindra Bolero Pickup': { capacity_kg: 1200, container_length_ft: 8, container_width_ft: 5, container_height_ft: 5, fuel_type: 'diesel', fuel_capacity_liters: 50, fuel_efficiency_kmpl: 14 },
  'Ashok Leyland Dost': { capacity_kg: 1500, container_length_ft: 9, container_width_ft: 5.5, container_height_ft: 5, fuel_type: 'diesel', fuel_capacity_liters: 40, fuel_efficiency_kmpl: 16 },
  'Ashok Leyland Bada Dost': { capacity_kg: 2000, container_length_ft: 10, container_width_ft: 5.5, container_height_ft: 5.5, fuel_type: 'diesel', fuel_capacity_liters: 45, fuel_efficiency_kmpl: 15 },
  'Maruti Super Carry': { capacity_kg: 740, container_length_ft: 7, container_width_ft: 4.5, container_height_ft: 4, fuel_type: 'cng', fuel_capacity_liters: 30, fuel_efficiency_kmpl: 22 },
  'Tata Intra': { capacity_kg: 1500, container_length_ft: 9, container_width_ft: 5, container_height_ft: 5, fuel_type: 'diesel', fuel_capacity_liters: 40, fuel_efficiency_kmpl: 16 },
  'Tata Yodha': { capacity_kg: 2500, container_length_ft: 10, container_width_ft: 6, container_height_ft: 6, fuel_type: 'diesel', fuel_capacity_liters: 60, fuel_efficiency_kmpl: 14 },
  'Piaggio Ape Cargo': { capacity_kg: 500, container_length_ft: 5, container_width_ft: 4, container_height_ft: 4, fuel_type: 'cng', fuel_capacity_liters: 15, fuel_efficiency_kmpl: 25 },
  'Tata 407': { capacity_kg: 3500, container_length_ft: 14, container_width_ft: 6, container_height_ft: 6, fuel_type: 'diesel', fuel_capacity_liters: 80, fuel_efficiency_kmpl: 10 },
  'Eicher Pro 1049': { capacity_kg: 5000, container_length_ft: 17, container_width_ft: 7, container_height_ft: 7, fuel_type: 'diesel', fuel_capacity_liters: 120, fuel_efficiency_kmpl: 8 },
  'Tata 709 / 1109': { capacity_kg: 9000, container_length_ft: 19, container_width_ft: 7, container_height_ft: 7, fuel_type: 'diesel', fuel_capacity_liters: 150, fuel_efficiency_kmpl: 6 },
  'Eicher Pro 2049': { capacity_kg: 9000, container_length_ft: 20, container_width_ft: 7, container_height_ft: 7, fuel_type: 'diesel', fuel_capacity_liters: 150, fuel_efficiency_kmpl: 6 },
  'BharatBenz 1015R': { capacity_kg: 10000, container_length_ft: 20, container_width_ft: 7, container_height_ft: 7, fuel_type: 'diesel', fuel_capacity_liters: 160, fuel_efficiency_kmpl: 5.5 },
  'Tata Signa (Multi-axle)': { capacity_kg: 25000, container_length_ft: 32, container_width_ft: 8, container_height_ft: 8, fuel_type: 'diesel', fuel_capacity_liters: 300, fuel_efficiency_kmpl: 4 },
  'Ashok Leyland U-Truck': { capacity_kg: 25000, container_length_ft: 32, container_width_ft: 8, container_height_ft: 8, fuel_type: 'diesel', fuel_capacity_liters: 300, fuel_efficiency_kmpl: 4 },
  'Volvo FM / FMX': { capacity_kg: 40000, container_length_ft: 40, container_width_ft: 8, container_height_ft: 9, fuel_type: 'diesel', fuel_capacity_liters: 400, fuel_efficiency_kmpl: 3.5 },
  'Custom': { capacity_kg: 1000, container_length_ft: 0, container_width_ft: 0, container_height_ft: 0, fuel_type: 'diesel', fuel_capacity_liters: 60, fuel_efficiency_kmpl: 12 },
}

// ─── Add Vehicle Modal ────────────────────────────────────────────────────────
function AddVehicleModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [formData, setFormData] = useState({
    plate_number: '',
    vehicle_type: 'truck' as string,
    vehicle_model: '' as string,
    capacity_kg: 1000,
    fuel_type: 'diesel',
    fuel_capacity_liters: 60,
    fuel_efficiency_kmpl: 12,
    spark_id: '',
    driver_name: '',
    driver_phone: '',
    container_length_ft: 0,
    container_width_ft: 0,
    container_height_ft: 0,
  })

  const handleModelSelect = (model: string) => {
    const preset = INDIAN_TRUCK_PRESETS[model]
    if (preset && model !== 'Custom') {
      setFormData(prev => ({
        ...prev,
        vehicle_model: model,
        capacity_kg: preset.capacity_kg,
        container_length_ft: preset.container_length_ft,
        container_width_ft: preset.container_width_ft,
        container_height_ft: preset.container_height_ft,
        fuel_type: preset.fuel_type,
        fuel_capacity_liters: preset.fuel_capacity_liters,
        fuel_efficiency_kmpl: preset.fuel_efficiency_kmpl,
      }))
    } else {
      setFormData(prev => ({ ...prev, vehicle_model: model }))
    }
  }

  const mutation = useMutation({
    mutationFn: (data: typeof formData) => vehiclesAPI.create({ ...data, status: 'available' }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      toast.success('Vehicle added successfully')
      
      // Trigger WhatsApp if driver was added
      if (data && data._driver_phone) {
        const appLink = "https://margixindia.vercel.app/login";
        const emailMsg = data._driver_email ? `📧 ईमेल: ${data._driver_email}\n` : '';
        const passMsg = data._driver_password ? `🔐 अस्थायी पासवर्ड: ${data._driver_password}\n` : '';
        
        const msg = `*मार्गीक्स इंडिया में आपका स्वागत है, ${data._driver_name}!* 🚚\n\n` +
          `आपका वाहन फ्लीट इंटेलिजेंस नेटवर्क पर पंजीकृत हो गया है।\n\n` +
          `*आवश्यक कार्रवाई:* कृपया ऐप इंस्टॉल करें और ट्रिप प्राप्त करने के लिए लॉग इन करें।\n` +
          `📱 ऐप इंस्टॉल करें और लॉगिन करें: ${appLink}\n` +
          emailMsg + passMsg;
          
        window.open(`https://wa.me/${data._driver_phone.replace(/\\D/g, '')}?text=${encodeURIComponent(msg)}`, '_blank');
      }
      
      onClose()
      setFormData({
        plate_number: '', vehicle_type: 'truck', vehicle_model: '', capacity_kg: 1000,
        fuel_type: 'diesel', fuel_capacity_liters: 60, fuel_efficiency_kmpl: 12,
        spark_id: '', driver_name: '', driver_phone: '',
        container_length_ft: 0, container_width_ft: 0, container_height_ft: 0,
      })
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || 'Failed to add vehicle')
    }
  })

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-surface2/80 backdrop-blur-sm" onClick={onClose} />
      <Card className="w-full max-w-xl animate-fade-up relative z-10 glass shadow-xl overflow-hidden border-slate-200 bg-white" glass={false}>
        <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-yellow-400/20 rounded-lg flex items-center justify-center border border-yellow-400/30">
              <Truck size={16} className="text-yellow-400" />
            </div>
            <h2 className="font-heading font-bold text-lg text-slate-900">Add New Vehicle</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-slate-900 transition-colors">
            <X size={20} />
          </button>
        </div>

        <form className="p-6 space-y-4 max-h-[80vh] overflow-y-auto" onSubmit={(e) => { e.preventDefault(); mutation.mutate(formData); }}>
          {/* Truck Model Preset */}
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Truck Model (India)</label>
            <select
              className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-yellow-400/50 transition-colors"
              value={formData.vehicle_model}
              onChange={e => handleModelSelect(e.target.value)}
            >
              <option value="">— Select Truck Model —</option>
              {Object.keys(INDIAN_TRUCK_PRESETS).map(m => (
                <option key={m} value={m}>{m} — {INDIAN_TRUCK_PRESETS[m].capacity_kg.toLocaleString()} kg</option>
              ))}
            </select>
            {formData.vehicle_model && formData.vehicle_model !== 'Custom' && (
              <p className="text-[10px] text-emerald-600 font-bold mt-1 ml-1">
                ✓ Auto-filled: {formData.capacity_kg.toLocaleString()} kg · {formData.container_length_ft}×{formData.container_width_ft}×{formData.container_height_ft} ft
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Plate Number</label>
            <input
              required
              className="w-full bg-surface2 border border-border rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-yellow-400/50 transition-colors mono"
              placeholder="e.g. DL-1005"
              value={formData.plate_number}
              onChange={e => setFormData({ ...formData, plate_number: e.target.value.toUpperCase() })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Vehicle Type</label>
              <select
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-yellow-400/50 transition-colors"
                value={formData.vehicle_type}
                onChange={e => setFormData({ ...formData, vehicle_type: e.target.value })}
              >
                {VEHICLE_TYPES.map(t => <option key={t} value={t} className="bg-white">{t.toUpperCase()}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Capacity (kg)</label>
              <input
                type="number"
                required
                className="w-full bg-surface2 border border-border rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-yellow-400/50 transition-colors mono"
                value={formData.capacity_kg}
                onChange={e => setFormData({ ...formData, capacity_kg: Number(e.target.value) })}
              />
            </div>
          </div>

          {/* Container Dimensions */}
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Container Size (feet) — L × W × H</label>
            <div className="grid grid-cols-3 gap-3">
              <input type="number" step="0.5" placeholder="Length"
                className="w-full bg-surface2 border border-border rounded-xl px-3 py-2.5 text-sm text-text focus:outline-none focus:border-yellow-400/50 mono"
                value={formData.container_length_ft || ''}
                onChange={e => setFormData({ ...formData, container_length_ft: Number(e.target.value) })}
              />
              <input type="number" step="0.5" placeholder="Width"
                className="w-full bg-surface2 border border-border rounded-xl px-3 py-2.5 text-sm text-text focus:outline-none focus:border-yellow-400/50 mono"
                value={formData.container_width_ft || ''}
                onChange={e => setFormData({ ...formData, container_width_ft: Number(e.target.value) })}
              />
              <input type="number" step="0.5" placeholder="Height"
                className="w-full bg-surface2 border border-border rounded-xl px-3 py-2.5 text-sm text-text focus:outline-none focus:border-yellow-400/50 mono"
                value={formData.container_height_ft || ''}
                onChange={e => setFormData({ ...formData, container_height_ft: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Fuel Type</label>
              <select
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-yellow-400/50 transition-colors"
                value={formData.fuel_type}
                onChange={e => setFormData({ ...formData, fuel_type: e.target.value })}
              >
                {FUEL_TYPES.map(t => <option key={t} value={t} className="bg-white">{t.toUpperCase()}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Efficiency (km/L)</label>
              <input
                type="number"
                step="0.1"
                required
                className="w-full bg-surface2 border border-border rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-yellow-400/50 transition-colors mono"
                value={formData.fuel_efficiency_kmpl}
                onChange={e => setFormData({ ...formData, fuel_efficiency_kmpl: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Spark Hardware ID (Optional)</label>
            <input
              className="w-full bg-surface2 border border-border rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-yellow-400/50 transition-colors mono"
              placeholder="e.g. SPK-9901"
              value={formData.spark_id}
              onChange={e => setFormData({ ...formData, spark_id: e.target.value })}
            />
          </div>

          <div className="pt-2 border-t border-slate-100">
            <p className="text-[10px] uppercase tracking-widest font-black text-slate-900 mb-3">Driver Onboarding (Optional)</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Driver Name</label>
                <input
                  className="w-full bg-surface2 border border-border rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-yellow-400/50 transition-colors"
                  placeholder="e.g. Rajesh Kumar"
                  value={formData.driver_name}
                  onChange={e => setFormData({ ...formData, driver_name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">WhatsApp Number</label>
                <input
                  type="tel"
                  className="w-full bg-surface2 border border-border rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-yellow-400/50 transition-colors mono"
                  placeholder="e.g. +919876543210"
                  value={formData.driver_phone}
                  onChange={e => setFormData({ ...formData, driver_phone: e.target.value })}
                />
              </div>
            </div>
            {formData.driver_phone && (
              <p className="text-[10px] text-emerald-600 font-bold mt-2 ml-1">
                ✓ A WhatsApp message with login details will be sent automatically.
              </p>
            )}
          </div>

          <div className="pt-4 flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={onClose} type="button">Cancel</Button>
            <Button variant="accent" className="flex-1" type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Spinner size={16} /> : 'Save Vehicle'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

// ─── Edit Vehicle Modal ───────────────────────────────────────────────────────
function EditVehicleModal({ vehicle, onClose }: { vehicle: any; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [formData, setFormData] = useState({
    plate_number: vehicle.plate_number || '',
    vehicle_type: vehicle.vehicle_type || 'truck',
    capacity_kg: vehicle.capacity_kg || 1000,
    fuel_type: vehicle.fuel_type || 'diesel',
    fuel_capacity_liters: vehicle.fuel_capacity_liters || 60,
    fuel_efficiency_kmpl: vehicle.fuel_efficiency_kmpl || 12,
    spark_id: vehicle.spark_id || '',
    status: vehicle.status || 'available',
  })

  const mutation = useMutation({
    mutationFn: (data: typeof formData) => vehiclesAPI.update(vehicle.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      toast.success(`${vehicle.plate_number} updated successfully`)
      onClose()
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || 'Failed to update vehicle')
    }
  })

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-surface2/80 backdrop-blur-sm" onClick={onClose} />
      <Card className="w-full max-w-xl animate-fade-up relative z-10 shadow-xl overflow-hidden border-slate-200 bg-white" glass={false}>
        <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-amber-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-amber-400/20 rounded-lg flex items-center justify-center border border-amber-400/30">
              <Pencil size={15} className="text-amber-500" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-lg text-slate-900">Edit Vehicle</h2>
              <p className="text-[11px] text-muted font-mono">{vehicle.plate_number}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-slate-900 transition-colors">
            <X size={20} />
          </button>
        </div>

        <form className="p-6 space-y-4 max-h-[80vh] overflow-y-auto" onSubmit={(e) => { e.preventDefault(); mutation.mutate(formData); }}>
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Plate Number</label>
            <input
              required
              className="w-full bg-surface2 border border-border rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-amber-400/50 transition-colors mono"
              value={formData.plate_number}
              onChange={e => setFormData({ ...formData, plate_number: e.target.value.toUpperCase() })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Vehicle Type</label>
              <select
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-amber-400/50 transition-colors"
                value={formData.vehicle_type}
                onChange={e => setFormData({ ...formData, vehicle_type: e.target.value })}
              >
                {VEHICLE_TYPES.map(t => <option key={t} value={t} className="bg-white">{t.toUpperCase()}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Status</label>
              <select
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-amber-400/50 transition-colors"
                value={formData.status}
                onChange={e => setFormData({ ...formData, status: e.target.value })}
              >
                {STATUS_OPTS.map(s => <option key={s} value={s} className="bg-white">{s.replace('_', ' ').toUpperCase()}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Capacity (kg)</label>
              <input
                type="number"
                required
                className="w-full bg-surface2 border border-border rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-amber-400/50 transition-colors mono"
                value={formData.capacity_kg}
                onChange={e => setFormData({ ...formData, capacity_kg: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Fuel Type</label>
              <select
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-amber-400/50 transition-colors"
                value={formData.fuel_type}
                onChange={e => setFormData({ ...formData, fuel_type: e.target.value })}
              >
                {FUEL_TYPES.map(t => <option key={t} value={t} className="bg-white">{t.toUpperCase()}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Fuel Cap. (L)</label>
              <input
                type="number"
                className="w-full bg-surface2 border border-border rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-amber-400/50 transition-colors mono"
                value={formData.fuel_capacity_liters}
                onChange={e => setFormData({ ...formData, fuel_capacity_liters: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Efficiency (km/L)</label>
              <input
                type="number"
                step="0.1"
                className="w-full bg-surface2 border border-border rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-amber-400/50 transition-colors mono"
                value={formData.fuel_efficiency_kmpl}
                onChange={e => setFormData({ ...formData, fuel_efficiency_kmpl: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-widest font-bold text-muted ml-1">Spark Hardware ID</label>
            <input
              className="w-full bg-surface2 border border-border rounded-xl px-4 py-2.5 text-sm text-text focus:outline-none focus:border-amber-400/50 transition-colors mono"
              placeholder="e.g. SPK-9901"
              value={formData.spark_id}
              onChange={e => setFormData({ ...formData, spark_id: e.target.value })}
            />
          </div>

          <div className="pt-4 flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={onClose} type="button">Cancel</Button>
            <Button
              className="flex-1 bg-amber-500 hover:bg-amber-600 text-white border-0"
              type="submit"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? <Spinner size={16} /> : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

// ─── Location Modal ───────────────────────────────────────────────────────────
function LocationModal({ vehicle, onClose }: { vehicle: any; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const hasLocation = vehicle.latitude && vehicle.longitude

  const coordsText = hasLocation
    ? `${vehicle.latitude.toFixed(6)}, ${vehicle.longitude.toFixed(6)}`
    : null

  const googleMapsUrl = hasLocation
    ? `https://www.google.com/maps?q=${vehicle.latitude},${vehicle.longitude}`
    : null

  const handleCopy = () => {
    if (!coordsText) return
    navigator.clipboard.writeText(coordsText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-surface2/80 backdrop-blur-sm" onClick={onClose} />
      <Card className="w-full max-w-md animate-fade-up relative z-10 shadow-xl overflow-hidden border-slate-200 bg-white" glass={false}>
        <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-yellow-400/20 rounded-lg flex items-center justify-center border border-yellow-400/30">
              <Navigation size={15} className="text-yellow-400" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-base text-white">Live Location</h2>
              <p className="text-[11px] text-slate-400 font-mono">{vehicle.plate_number}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {hasLocation ? (
            <>
              {/* Map Preview */}
              <div className="relative w-full h-40 rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                <iframe
                  title="vehicle-location"
                  src={`https://maps.google.com/maps?q=${vehicle.latitude},${vehicle.longitude}&z=15&output=embed`}
                  className="w-full h-full border-0"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>

              {/* Coordinates */}
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-1">GPS Coordinates</p>
                    <p className="font-mono text-sm font-bold text-slate-900">{coordsText}</p>
                  </div>
                  <button
                    onClick={handleCopy}
                    className="p-2 hover:bg-slate-200 rounded-lg transition-colors text-muted hover:text-slate-900"
                  >
                    {copied ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Copy size={16} />}
                  </button>
                </div>
              </div>

              {/* Sync time */}
              {vehicle.last_sync && (
                <div className="flex items-center gap-2 text-[11px] text-muted">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Last synced: {new Date(vehicle.last_sync).toLocaleTimeString()}
                </div>
              )}

              {/* Open in Maps */}
              <a
                href={googleMapsUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold rounded-xl transition-colors"
              >
                <ExternalLink size={14} />
                Open in Google Maps
              </a>
            </>
          ) : (
            <div className="py-10 flex flex-col items-center gap-3 text-center">
              <div className="w-14 h-14 rounded-full bg-red-50 border border-red-200 flex items-center justify-center">
                <MapPin size={24} className="text-red-400" />
              </div>
              <div>
                <p className="font-bold text-slate-900">No Signal</p>
                <p className="text-sm text-muted mt-1">
                  GPS data unavailable for <span className="font-mono font-bold">{vehicle.plate_number}</span>.<br />
                  Ensure the vehicle has an active GPS device linked.
                </p>
              </div>
              {vehicle.spark_id ? (
                <div className="text-xs bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-yellow-800">
                  Spark ID: <span className="font-mono font-bold">{vehicle.spark_id}</span>
                </div>
              ) : (
                <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-600">
                  No Spark GPS device linked to this vehicle
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

// ─── Settings Dropdown ────────────────────────────────────────────────────────
function SettingsDropdown({
  vehicle,
  onEdit,
  onDelete,
}: {
  vehicle: any
  onEdit: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setConfirmDelete(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const deleteMutation = useMutation({
    mutationFn: () => vehiclesAPI.delete(vehicle.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      toast.success(`${vehicle.plate_number} deleted`)
      setOpen(false)
      setConfirmDelete(false)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || 'Failed to delete vehicle')
    }
  })

  return (
    <div className="relative" ref={ref}>
      <button
        id={`settings-btn-${vehicle.id}`}
        onClick={() => { setOpen(!open); setConfirmDelete(false) }}
        className={clsx(
          "p-2 rounded-lg transition-colors",
          open
            ? "bg-slate-900 text-white"
            : "hover:bg-slate-100 text-muted hover:text-slate-900"
        )}
        title="Asset Settings"
      >
        <Settings size={16} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-52 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden animate-fade-up">
          {!confirmDelete ? (
            <>
              <div className="px-3 py-2 border-b border-slate-100">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted">Asset Actions</p>
                <p className="text-[11px] font-mono font-bold text-slate-900">{vehicle.plate_number}</p>
              </div>
              <div className="p-1">
                <button
                  id={`edit-vehicle-${vehicle.id}`}
                  onClick={() => { setOpen(false); onEdit() }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-amber-50 text-left transition-colors group"
                >
                  <div className="w-7 h-7 rounded-lg bg-amber-50 group-hover:bg-amber-100 border border-amber-200 flex items-center justify-center transition-colors">
                    <Pencil size={13} className="text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Edit Details</p>
                    <p className="text-[10px] text-muted">Update vehicle info</p>
                  </div>
                </button>
                <button
                  id={`delete-vehicle-${vehicle.id}`}
                  onClick={() => setConfirmDelete(true)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-red-50 text-left transition-colors group"
                >
                  <div className="w-7 h-7 rounded-lg bg-red-50 group-hover:bg-red-100 border border-red-200 flex items-center justify-center transition-colors">
                    <Trash2 size={13} className="text-red-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Delete Vehicle</p>
                    <p className="text-[10px] text-muted">Remove from fleet</p>
                  </div>
                </button>
              </div>
            </>
          ) : (
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center">
                  <Trash2 size={13} className="text-red-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">Confirm Delete</p>
                  <p className="text-[10px] text-muted font-mono">{vehicle.plate_number}</p>
                </div>
              </div>
              <p className="text-xs text-slate-600 mb-3">
                This will permanently remove this vehicle from your fleet. This action cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 py-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  id={`confirm-delete-${vehicle.id}`}
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  className="flex-1 py-1.5 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center justify-center"
                >
                  {deleteMutation.isPending ? <Spinner size={12} /> : 'Delete'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Fleet Page ──────────────────────────────────────────────────────────
export default function FleetPage() {
  const role = useAuthStore(s => s.role)
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState<any>(null)
  const [trackingVehicle, setTrackingVehicle] = useState<any>(null)
  const [mounted, setMounted] = useState(false)
  const queryClient = useQueryClient()

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 100)
    return () => clearTimeout(timer)
  }, [])

  // Real-time updates for Fleet table
  useEffect(() => {
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
    }

    const channel = supabase
      .channel('fleet_page_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shipments' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'routes' }, invalidate)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient])

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ['vehicles', filter],
    queryFn: () => vehiclesAPI.list({ status: filter === 'all' ? undefined : filter, limit: 100 }),
    refetchInterval: 15_000,
  })

  const { data: summary } = useQuery({
    queryKey: ['fleet-summary'],
    queryFn: vehiclesAPI.summary,
  })

  const filtered = vehicles.filter((v: any) =>
    v.plate_number.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="font-display text-5xl font-black text-slate-900 tracking-tighter uppercase leading-none">
            Fleet <span className="text-yellow-500">Intelligence</span>
          </h1>
          <p className="text-muted font-bold tracking-tight mt-3 flex items-center gap-2">
            <Info size={14} className="text-yellow-600" />
            Monitoring <span className="text-slate-900">{summary?.total ?? '—'}</span> high-performance assets in real-time
          </p>
        </div>
        {role !== 'driver' && (
          <Button variant="accent" size="md" className="shadow-yellow-400/20" onClick={() => setIsAddModalOpen(true)}>
            <Plus size={18} strokeWidth={3} /> Add New Asset
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Total Fleet', value: summary?.total ?? 0, colorClass: 'text-slate-900' },
          { label: 'Live Delivery', value: summary?.active ?? 0, colorClass: 'text-yellow-600' },
          { label: 'Idle Ready', value: summary?.idle ?? 0, colorClass: 'text-muted' },
          { label: 'Scheduled Maint.', value: summary?.maintenance ?? 0, colorClass: 'text-orange-500' },
          { label: 'Disconnected', value: summary?.offline ?? 0, colorClass: 'text-red-500' },
        ].map(({ label, value, colorClass }) => (
          <div key={label} className="glass-card p-6 relative group overflow-hidden border-slate-200 bg-white shadow-sm">
            <div className={clsx("font-display text-4xl font-black mb-1 leading-none tracking-tighter", colorClass)}>{value}</div>
            <div className={clsx("text-[10px] font-black uppercase tracking-[0.2em] mt-1", colorClass)}>{label}</div>
            <div className="absolute -right-4 -bottom-4 opacity-[0.03] rotate-12 group-hover:rotate-0 transition-all duration-500 grayscale">
              <Truck size={80} />
            </div>
          </div>
        ))}
      </div>

      {/* Filters + Search */}
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2 w-full max-w-sm focus-within:border-yellow-400/50 transition-colors shadow-sm">
          <Search size={16} className="text-muted" />
          <input
            placeholder="Search assets by plate..."
            className="bg-transparent border-none outline-none text-sm text-slate-900 w-full placeholder:text-muted"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={clsx(
                "px-4 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all",
                filter === s ? "bg-white text-slate-900 shadow-sm border border-slate-200" : "text-muted hover:text-slate-700"
              )}
            >
              {s.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Table Section */}
      <Card className="border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto pb-24">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                {['Asset Details', 'Type', 'Status', 'Fuel Status', 'Intelligence', 'Location', 'Actions'].map(h => (
                  <th key={h} className="px-6 py-5 text-left text-[10px] font-black text-muted uppercase tracking-[0.2em]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-20">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <Spinner size={32} />
                      <span className="text-muted text-xs font-heading">Synchronizing Fleet Vector...</span>
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-20">
                    <div className="flex flex-col items-center justify-center text-muted gap-3">
                      <div className="w-16 h-16 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center">
                        <Truck size={28} className="text-slate-300" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold text-slate-900">No assets found</p>
                        <p className="text-xs text-muted mt-1">
                          {search ? 'No vehicles match your search.' : 'Add your first vehicle to get started.'}
                        </p>
                      </div>
                      {!search && role !== 'driver' && (
                        <Button variant="accent" size="sm" onClick={() => setIsAddModalOpen(true)}>
                          <Plus size={14} strokeWidth={3} /> Add Vehicle
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((v: any, idx: number) => {
                  const currentLoad = v.current_load_kg || (v.capacity_kg - (v.available_capacity_kg ?? v.capacity_kg))
                  const isLoaded = v.status === 'on_route' || currentLoad > 0

                  return (
                  <tr
                    key={v.id}
                    className="border-b border-slate-100 hover:bg-slate-50 transition-colors group"
                    style={{ animationDelay: (idx * 50) + 'ms' }}
                  >
                    {/* Asset Details */}
                    <td className="px-6 py-5">
                      <div className="font-display font-black text-slate-900 text-base group-hover:text-yellow-600 transition-all uppercase tracking-tight">
                        {v.plate_number}
                      </div>
                      <div className="text-[10px] text-muted mt-0.5 font-mono">
                        {v.vehicle_model || v.vehicle_type} · {v.capacity_kg?.toLocaleString()} kg
                      </div>
                      {(v.container_length_ft > 0) && (
                        <div className="text-[9px] text-blue-600 font-bold mt-0.5">
                          📦 {v.container_length_ft}×{v.container_width_ft}×{v.container_height_ft} ft
                        </div>
                      )}
                    </td>

                    {/* Type */}
                    <td className="px-6 py-5 text-left">
                      <div className="flex flex-col gap-1">
                        <div className="text-[10px] font-black uppercase bg-slate-100 border border-slate-200 px-2 py-1 rounded w-fit text-muted tracking-widest">
                          {v.vehicle_type}
                        </div>
                        {v.spark_id && (
                          <div className="text-[9px] font-bold text-yellow-600 bg-yellow-400/10 border border-yellow-400/20 px-2 py-0.5 rounded w-fit uppercase tracking-tighter">
                            GPS: {v.spark_id}
                          </div>
                        )}
                        {/* Load Bar */}
                        <div className="mt-1">
                          <div className="flex items-center justify-between text-[8px] font-bold text-muted mb-0.5">
                            <span>LOAD</span>
                            <span>
                              {isLoaded ? (v.capacity_kg || 0).toLocaleString() : 0} / {(v.capacity_kg || 0).toLocaleString()} kg
                            </span>
                          </div>
                          <div className="w-20 bg-slate-200 h-1.5 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-1000 ease-out ${isLoaded ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)] relative overflow-hidden' : 'bg-emerald-500'}`}
                              style={{ width: mounted ? `${isLoaded ? 100 : 0}%` : '0%' }}
                            >
                              {isLoaded && (
                                <div className="absolute inset-0 bg-white/20 -translate-x-full animate-shimmer" style={{ backgroundImage: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)' }} />
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200 w-fit">
                        <StatusDot status={v.status} />
                        <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">
                          {v.status.replace('_', ' ')}
                        </span>
                      </div>
                    </td>

                    {/* Fuel Status */}
                    <td className="px-6 py-5">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <Fuel size={12} className="text-yellow-500" />
                          <span className="font-display font-black text-xs text-slate-900">
                            {v.current_fuel_liters?.toFixed(1) || '0.0'}
                          </span>
                          <span className="text-[10px] font-black text-muted">/ {v.fuel_capacity_liters || 60}L</span>
                        </div>
                        <div className="w-20 bg-slate-200 h-1 rounded-full overflow-hidden">
                          <div
                            className="bg-yellow-500 h-full"
                            style={{ width: `${((v.current_fuel_liters || 0) / (v.fuel_capacity_liters || 60)) * 100}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Intelligence */}
                    <td className="px-6 py-5">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-3">
                          {v.status === 'on_route' ? (
                            <>
                              <div className="flex items-center gap-1 text-sky-600">
                                <Cloud size={14} />
                                <span className="text-[10px] font-black uppercase tracking-tighter">Live Sync</span>
                              </div>
                              <div className="flex items-center gap-1 text-orange-600">
                                <Thermometer size={14} />
                                <span className="text-[10px] font-black uppercase tracking-tighter">Active GPS</span>
                              </div>
                            </>
                          ) : (
                            <span className="text-[10px] font-black text-muted uppercase italic tracking-widest">Idle State</span>
                          )}
                        </div>
                        {/* Capacity Status Badge */}
                        <div className="mt-1 flex flex-col gap-1">
                          {v.status === 'on_route' ? (
                            <span className="text-[9px] font-bold text-orange-600 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded w-fit uppercase tracking-tighter">
                              Fully Loaded (On Route)
                            </span>
                          ) : (
                            <span className="text-[9px] font-bold text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded w-fit uppercase tracking-tighter">
                              Free: {v.available_capacity_kg ?? v.capacity_kg} / {v.capacity_kg} kg
                            </span>
                          )}
                          {v.bidding_window_open && (
                            <span className="text-[9px] font-bold text-blue-600 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded w-fit uppercase tracking-tighter">
                              Matching Enabled
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Location */}
                    <td className="px-6 py-5">
                      <div className="font-mono text-[10px] text-muted leading-tight">
                        {v.latitude ? (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-emerald-500 animate-pulse">●</span>
                              <span className="text-slate-700 font-bold">
                                {v.latitude.toFixed(4)}, {v.longitude.toFixed(4)}
                              </span>
                            </div>
                            {v.last_sync && (
                              <div className="text-[9px] text-muted ml-4 font-bold uppercase tracking-tighter">
                                {new Date(v.last_sync).toLocaleTimeString()}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                            <span className="text-red-500 font-black">NO SIGNAL</span>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-1 transition-opacity">
                        {/* Location/Tracking */}
                        <button
                          id={`track-btn-${v.id}`}
                          onClick={() => setTrackingVehicle(v)}
                          className="p-2 hover:bg-slate-100 rounded-lg text-muted hover:text-yellow-600 transition-colors"
                          title="Live Location"
                        >
                          <MapPin size={16} />
                        </button>

                        {/* Analytics */}
                        <button
                          id={`analytics-btn-${v.id}`}
                          onClick={() => navigate('/analytics?vehicle=' + v.id)}
                          className="p-2 hover:bg-slate-100 rounded-lg text-muted hover:text-slate-900 transition-colors"
                          title="Analytics"
                        >
                          <BarChart2 size={16} />
                        </button>

                        {/* Settings Dropdown with Edit + Delete */}
                        {role !== 'driver' && (
                          <SettingsDropdown
                            vehicle={v}
                            onEdit={() => setEditingVehicle(v)}
                            onDelete={() => {}}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modals */}
      <AddVehicleModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} />
      {editingVehicle && (
        <EditVehicleModal vehicle={editingVehicle} onClose={() => setEditingVehicle(null)} />
      )}
      {trackingVehicle && (
        <LocationModal vehicle={trackingVehicle} onClose={() => setTrackingVehicle(null)} />
      )}
    </div>
  )
}
