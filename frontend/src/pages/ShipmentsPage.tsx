import {
  Plus, Search, Package, MapPin, Layers,
  ShieldCheck, ShieldAlert, Zap, Navigation, Loader2,
  Calendar, Clock, AlertTriangle, Scale, Smartphone, Copy, MessageCircle, CheckCircle, Ruler,
  Minus, X
} from 'lucide-react'
import axios from 'axios'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

import { shipmentsAPI, deliveryPointsAPI, telemetryAPI, vehiclesAPI } from '@/services/api'
import { Card, StatusDot, Button, Badge } from '@/components/ui'
import LiveMap from '@/components/map/LiveMap'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { useDraftStore } from '@/store/draftStore'
import { supabase } from '@/services/supabase'

const STATUS_OPTIONS = ['all', 'created', 'picked_up', 'in_transit', 'delivered', 'cancelled']
const PRIORITIES = ['low', 'medium', 'high', 'critical']

import { formatEta } from '@/utils/timeFormat'

function InlineTrackingMap({ trackingId, allVehicles }: { trackingId: string, allVehicles: any[] }) {
  const { data: trackInfo, isLoading } = useQuery({
    queryKey: ['trackPublicly', trackingId],
    queryFn: () => shipmentsAPI.trackPublicly(trackingId),
    refetchInterval: 10000,
  })

  const [isCalling, setIsCalling] = useState(false)

  if (isLoading) return <div className="h-64 flex items-center justify-center"><Loader2 size={24} className="animate-spin text-yellow-500" /></div>
  
  if (!trackInfo || !trackInfo.vehicle?.id) {
    return <div className="h-64 flex items-center justify-center text-xs font-bold text-muted uppercase tracking-widest bg-slate-50 rounded-2xl">Awaiting Driver Assignment</div>
  }

  // Need to provide vehicle to LiveMap, so it knows the start position.  
  // It handles its own realtime updates if it has the ID.
  const activeVehicle = {
    id: trackInfo.vehicle.id,
    plate_number: trackInfo.vehicle.plate_number,
    status: trackInfo.vehicle.status,
    latitude: trackInfo.vehicle.lat,
    longitude: trackInfo.vehicle.lng,
    vehicle_type: trackInfo.vehicle.type
  }

  // Fallback map array with only the active vehicle if it's not in allVehicles
  const mapVehicles = allVehicles.some(v => v.id === activeVehicle.id) ? allVehicles : [activeVehicle]

  let customPendingStops: any[] = []
  if (trackInfo && trackInfo.tracking_id?.startsWith('CM-')) {
    if (trackInfo.status === 'created' || trackInfo.status === 'assigned' || trackInfo.status === 'scheduled') {
      customPendingStops = [{
        status: 'pending',
        sequence: 1,
        delivery_points: {
          latitude: trackInfo.origin_lat,
          longitude: trackInfo.origin_lng
        }
      }]
    } else if (trackInfo.status === 'in_transit') {
      customPendingStops = [{
        status: 'pending',
        sequence: 1,
        delivery_points: {
          latitude: trackInfo.destination?.lat,
          longitude: trackInfo.destination?.lng
        }
      }]
    }
  }

  const handleCallDriver = async () => {
    try {
      setIsCalling(true)
      await telemetryAPI.callDriver(activeVehicle.id)
      toast.success('Ringing driver app...')
    } catch (e: any) {
      toast.error('Failed to call driver: ' + e.message)
    } finally {
      setIsCalling(false)
    }
  }

  return (
    <div className="h-80 w-full rounded-2xl overflow-hidden border-2 border-slate-100 bg-white shadow-inner relative group">
      <div className="absolute top-4 left-4 z-10 bg-white/90 backdrop-blur-md px-4 py-2 rounded-xl shadow-lg border border-slate-100 flex items-center justify-between min-w-[200px]">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-muted">ETA</div>
            <div className="text-xs font-black text-slate-900">{trackInfo.eta_minutes ? formatEta(trackInfo.eta_minutes) : 'CALCULATING...'}</div>
          </div>
        </div>
        <Button 
          size="sm" 
          className="ml-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1 text-xs font-bold flex items-center gap-2"
          onClick={handleCallDriver}
          disabled={isCalling}
        >
          {isCalling ? <Loader2 size={14} className="animate-spin" /> : <Smartphone size={14} />}
          {isCalling ? 'Calling...' : 'Call'}
        </Button>
      </div>
      <LiveMap vehicles={mapVehicles} selectedVehicleId={activeVehicle.id} customPendingStops={customPendingStops.length > 0 ? customPendingStops : undefined} />
    </div>
  )
}

function AssignDriverModal({ shipmentId, onClose }: { shipmentId: string, onClose: () => void }) {
  const [mode, setMode] = useState<'near' | 'any'>('near')
  const queryClient = useQueryClient()

  const { data: options = [], isLoading } = useQuery({
    queryKey: ['assignOptions', shipmentId, mode],
    queryFn: () => shipmentsAPI.getAssignOptions(shipmentId, mode),
  })

  const assignMutation = useMutation({
    mutationFn: (vehicleId: string) => shipmentsAPI.assignDriver(shipmentId, vehicleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      toast.success('Driver assigned successfully')
      onClose()
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.detail || 'Failed to assign driver')
    }
  })

  const vehiclesForMap = options.map((o: any) => ({
    id: o.id,
    plate_number: o.plate_number,
    status: o.status,
    latitude: o.latitude,
    longitude: o.longitude,
    vehicle_type: o.vehicle_type
  }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-8 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Assign Driver</h2>
            <p className="text-sm font-bold text-slate-500">Select a vehicle from the active fleet</p>
          </div>
          <div className="flex bg-slate-100 p-1 rounded-2xl">
            <button
              className={clsx("px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-colors", mode === 'near' ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500 hover:bg-slate-200")}
              onClick={() => setMode('near')}
            >
              Near Origin
            </button>
            <button
              className={clsx("px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-colors", mode === 'any' ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500 hover:bg-slate-200")}
              onClick={() => setMode('any')}
            >
              Show All
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-2">
          {/* Map Side */}
          <div className="bg-slate-50 relative border-r border-slate-100 h-64 md:h-full min-h-[300px]">
            {isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="animate-spin text-emerald-500" size={32} /></div>
            ) : (
              <LiveMap vehicles={vehiclesForMap} />
            )}
          </div>
          
          {/* List Side */}
          <div className="overflow-y-auto p-4 space-y-3 bg-white">
            {isLoading ? (
              <div className="flex justify-center p-10"><Loader2 className="animate-spin text-slate-300" size={24} /></div>
            ) : options.length === 0 ? (
              <div className="text-center p-10 text-slate-400 font-bold">No active vehicles found.</div>
            ) : (
              options.map((v: any) => (
                <div key={v.id} className="flex items-center justify-between p-4 rounded-2xl border-2 border-slate-100 hover:border-emerald-500 hover:shadow-lg hover:shadow-emerald-500/10 transition-all group">
                  <div>
                    <div className="text-lg font-black text-slate-900">{v.plate_number}</div>
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                      {v.vehicle_type} • {v.capacity_kg} KG Cap {v.distance_km ? `• ${v.distance_km.toFixed(1)} km away` : ''}
                    </div>
                  </div>
                  <Button 
                    variant="accent" 
                    onClick={() => assignMutation.mutate(v.id)}
                    disabled={assignMutation.isPending}
                    className="text-xs px-4 py-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-black uppercase tracking-widest"
                  >
                    Assign
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
        
        <div className="p-4 border-t border-slate-100 flex justify-end bg-slate-50">
          <Button variant="ghost" onClick={onClose} className="font-bold">Cancel</Button>
        </div>
      </div>
    </div>
  )
}


const CARGO_ARCHETYPES = [
  { id: 'standard', name: 'Standard Parcel', desc: 'Secure express delivery', icon: '/assets/cargo/parcel.png' },
  { id: 'heavy', name: 'Heavy Freight', desc: 'Industrial bulk cargo', icon: '/assets/cargo/freight.png' },
  { id: 'cold_chain', name: 'Cold Chain', desc: 'Temp-sensitive items', icon: '/assets/cargo/cold_chain.png' },
  { id: 'hazardous', name: 'Hazardous', desc: 'Special handling reqs', icon: '/assets/cargo/hazardous.png' },
]

export default function ShipmentsPage() {
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  
  const [expandedShipmentId, setExpandedShipmentId] = useState<string | null>(null)
  
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const openModal = useDraftStore(s => s.openModal)
  const [editingShipment, setEditingShipment] = useState<any>(null)
  const [confirmDeleteShipmentId, setConfirmDeleteShipmentId] = useState<string | null>(null)
  const [assignShipmentId, setAssignShipmentId] = useState<string | null>(null)

  const { data: shipments = [], isLoading } = useQuery({
    queryKey: ['shipments'],
    queryFn: () => shipmentsAPI.list(),
  })

  useEffect(() => {
    const channel = supabase
      .channel('public:shipments_and_manifests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shipments' }, () => {
        queryClient.invalidateQueries({ queryKey: ['shipments'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cargo_manifest' }, () => {
        queryClient.invalidateQueries({ queryKey: ['shipments'] })
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient])

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => shipmentsAPI.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      toast.success('Shipment status updated')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => shipmentsAPI.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      toast.success('Shipment deleted successfully')
    },
    onError: (error: any) => {
      const msg = error?.response?.data?.detail || error?.message || 'Failed to delete shipment'
      toast.error(typeof msg === 'string' ? msg : JSON.stringify(msg))
    }
  })

  const [neuralPipelineStep, setNeuralPipelineStep] = useState<number | null>(null)
  const [createdShipmentData, setCreatedShipmentData] = useState<any>(null)

  useEffect(() => {
    if (neuralPipelineStep !== null && neuralPipelineStep < 4) {
      const timer = setTimeout(() => {
        setNeuralPipelineStep((prev: any) => prev !== null ? prev + 1 : null)
      }, 2200)
      return () => clearTimeout(timer)
    }
  }, [neuralPipelineStep])

  useEffect(() => {
    const handleShipmentCreated = (e: any) => {
      setCreatedShipmentData(e.detail)
      setNeuralPipelineStep(1)
    }
    window.addEventListener('shipmentCreated', handleShipmentCreated)
    return () => window.removeEventListener('shipmentCreated', handleShipmentCreated)
  }, [])

  const filtered = shipments.filter((s: any) => {
    const matchesFilter = filter === 'all' || s.status === filter
    const matchesSearch = s.tracking_id.toLowerCase().includes(search.toLowerCase()) ||
      s.delivery_point?.name?.toLowerCase().includes(search.toLowerCase())
    return matchesFilter && matchesSearch
  })

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div>
          <h1 className="text-5xl font-black text-text font-display tracking-tight uppercase leading-none mb-2">
            Cargo Manifest (Updated)
          </h1>
          <p className="text-muted font-bold text-lg tracking-tight">
            Managing <span className="text-text">{shipments.length}</span> active shipments across the global logistics grid.
          </p>
        </div>
        <Button variant="accent" onClick={openModal} className="h-16 px-10 rounded-2xl shadow-2xl shadow-primary/20 bg-primary hover:bg-primary-dark text-bg font-black uppercase tracking-widest group">
          <Plus size={22} className="group-hover:rotate-90 transition-transform duration-300 mr-2" />
          Initialize New Shipment
        </Button>
      </div>

      <div className="bg-surface p-2 rounded-[2.5rem] border border-border shadow-2xl flex flex-col md:flex-row gap-2">
        <div className="relative flex-1 group">
          <Search className="absolute left-8 top-1/2 -translate-y-1/2 text-muted group-focus-within:text-primary transition-colors" size={20} />
          <input
            type="text"
            placeholder="Search by Tracking ID or Destination..."
            className="w-full h-16 pl-20 pr-8 bg-surface2 border-none rounded-[1.8rem] text-text font-bold placeholder:text-muted focus:ring-2 focus:ring-primary/20 transition-all outline-none text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex overflow-x-auto gap-1 p-1 custom-scrollbar">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={clsx(
                "px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap",
                filter === s ? "bg-primary text-bg shadow-lg shadow-primary/20" : "text-muted hover:bg-surface2"
              )}
            >
              {s.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {isLoading ? (
          <div className="py-40 flex flex-col items-center justify-center gap-4">
            <Loader2 className="w-10 h-10 text-yellow-500 animate-spin" />
            <p className="text-[10px] font-black uppercase text-muted tracking-[0.3em] animate-pulse">Syncing Cargo Manifest...</p>
          </div>
        ) : shipments.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-20 text-center bg-slate-50 rounded-[3rem] border-2 border-dashed border-slate-200">
            <Package className="text-muted mb-6" size={64} />
            <h3 className="text-xl font-bold text-slate-900 mb-2 uppercase tracking-tighter">No Active Neural Loads</h3>
            <p className="text-sm text-muted max-w-xs font-bold leading-relaxed">Initialize your first shipment tracking vector to begin logistics optimization.</p>
          </div>
        ) : (
          filtered.map((s: any) => (
            <Card key={s.id} className="relative group transition-all hover:scale-[1.01] hover:shadow-2xl border border-border p-0 overflow-visible mb-8 bg-surface shadow-2xl rounded-[2.5rem]">
              <div className="grid grid-cols-1 lg:grid-cols-4 items-center">

                {/* Column 1: Tracking Vector */}
                <div className="p-10 border-r border-border h-full flex flex-col justify-center">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">
                      {s.open_bidding && !s.bid_id ? 'Broadcast Status' : 'Tracking ID'}
                    </div>
                    {!(s.open_bidding && !s.bid_id) && (
                      <Badge variant="green" className="bg-success/10 text-success border-none rounded-full px-3 py-1 text-[8px] font-black uppercase tracking-widest whitespace-nowrap">
                        <ShieldCheck size={10} className="inline mr-1 mb-0.5" /> SECURE
                      </Badge>
                    )}
                  </div>
                  
                  {s.open_bidding && !s.bid_id ? (
                    <div className="flex items-center gap-3 mb-6">
                      <div className="relative flex items-center justify-center">
                        <div className="w-4 h-4 rounded-full bg-yellow-400 animate-ping absolute" />
                        <div className="w-4 h-4 rounded-full bg-yellow-500 relative z-10 shadow-[0_0_15px_rgba(234,179,8,0.8)]" />
                      </div>
                      <h3 className="text-2xl font-black text-yellow-500 tracking-tight leading-none">BIDDING ACTIVE</h3>
                    </div>
                  ) : (
                    <>
                      <h3 className="text-3xl font-black text-primary font-mono tracking-tight leading-none mb-6">{s.tracking_id}</h3>
                      <div className="bg-surface2 text-text px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest inline-block w-fit border border-border">
                        {s.priority} priority
                      </div>
                    </>
                  )}

                  {s.signature_data && (
                    <div className="mt-4 p-4 bg-surface2 border border-border rounded-xl">
                      <div className="text-[10px] font-black text-muted uppercase tracking-widest mb-2">Digital Signature (POD)</div>
                      <div className="font-mono text-emerald-400 font-bold text-lg">{s.signature_data}</div>
                    </div>
                  )}
                </div>

                {/* Column 2: Journey Logistics */}
                <div className="col-span-1 lg:col-span-1 p-10 border-r border-border flex flex-col gap-8">
                  <div className="space-y-2">
                    <div className="text-[8px] font-black text-muted uppercase tracking-[0.3em] mb-3 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_rgba(79,172,254,0.6)]" /> Departure
                    </div>
                    <div className="text-lg font-black text-text leading-tight">{s.origin_name || 'Pending Departure'}</div>
                    <div className="text-[10px] font-bold text-muted uppercase truncate max-w-[200px] tracking-tight">{s.origin_address || 'Origin not specified'}</div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-[8px] font-black text-muted uppercase tracking-[0.3em] mb-3 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-accent shadow-[0_0_8px_rgba(249,201,53,0.6)]" /> Destination
                    </div>
                    {s.open_bidding && !s.bid_id ? (
                      <div className="text-sm font-black text-muted italic">Waiting for Vendor Bid...</div>
                    ) : (
                      <>
                        <div className="text-lg font-black text-text leading-tight">{s.delivery_point?.name || 'Pending Destination'}</div>
                        <div className="text-[10px] font-bold text-muted uppercase truncate max-w-[200px] tracking-tight">{s.delivery_point?.address || 'Destination not specified'}</div>
                      </>
                    )}
                    {s.driver_name && (
                      <div className="mt-4 p-3 bg-surface2 border border-border rounded-xl">
                        <div className="text-[10px] font-black text-muted uppercase tracking-widest mb-1">Assigned Driver</div>
                        <div className="font-bold text-text">{s.driver_name}</div>
                      </div>
                    )}
                    
                    {s.received_by && (
                      <div className="mt-4 p-3 bg-surface2 border border-border rounded-xl">
                        <div className="text-[10px] font-black text-muted uppercase tracking-widest mb-1">Received By</div>
                        <div className="font-bold text-text">{s.received_by}</div>
                      </div>
                    )}

                    {s.signature_data && (
                      <div className="mt-4 p-4 bg-surface2 border border-border rounded-xl">
                        <div className="text-[10px] font-black text-muted uppercase tracking-widest mb-2">Digital Signature (POD)</div>
                        <div className="font-mono text-emerald-400 font-bold text-lg">{s.signature_data}</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Column 3: Cargo Payload */}
                <div className="p-10 border-r border-border h-full flex flex-col justify-center">
                  <div className="text-[10px] font-black text-muted uppercase tracking-[0.2em] mb-6">Cargo Payload</div>
                  
                  {s.open_bidding && !s.bid_id ? (
                    <div className="flex items-center gap-4 bg-surface2 p-4 rounded-2xl border border-border">
                      <div className="w-12 h-12 rounded-full bg-yellow-500/10 flex items-center justify-center">
                        <Layers className="text-yellow-500 animate-bounce" size={20} />
                      </div>
                      <div>
                        <div className="text-sm font-black text-text">Awaiting Vendor Cargo</div>
                        <div className="text-[9px] font-bold text-muted uppercase mt-1 tracking-widest">
                          Bids will determine load size
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-5">
                      <div className="w-16 h-16 rounded-2xl bg-surface2 flex items-center justify-center border border-border group-hover:bg-bg transition-colors shadow-lg">
                        <Layers className="text-primary" size={24} />
                      </div>
                      <div>
                        <div className="text-2xl font-black text-text leading-none mb-2">{s.total_items} Items</div>
                        <div className="text-[10px] font-bold text-muted uppercase tracking-widest">Total: {s.total_weight_kg} KG</div>
                        {s.capacity_bids && (
                          <div className="mt-3 p-2 bg-primary/10 border border-primary/20 rounded-xl">
                            <div className="text-[8px] font-black text-primary uppercase tracking-[0.2em] mb-1">
                              {s.capacity_bids.capacity_windows?.trigger_type === 'end_of_route' ? 'Vendor Backhaul Bid' : 'Vendor Forward Bid'}
                            </div>
                            <div className="text-xs font-bold text-text truncate max-w-[150px]">{s.capacity_bids.vendor_profiles?.company_name}</div>
                            <div className="text-[10px] font-black text-success uppercase tracking-widest">₹{s.capacity_bids.bid_amount}</div>
                            <div className="text-[8px] font-mono text-muted mt-1 truncate max-w-[150px]">{s.capacity_bids.eway_bill_ref} • {s.capacity_bids.load_configuration}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mt-6 flex flex-col items-start gap-3">
                    {!(s.open_bidding && !s.bid_id) && (
                      <button onClick={(e) => { e.stopPropagation(); navigate('/track/' + s.tracking_id) }} className="flex items-center gap-2 text-[10px] font-black uppercase text-primary hover:text-text transition-colors tracking-widest" title="Navigate Details">
                        <Navigation size={14} className="text-primary" /> Details
                      </button>
                    )}
                    
                    {!s.vehicle_id && !(s.open_bidding && !s.bid_id) && (
                      <button onClick={(e) => { e.stopPropagation(); setAssignShipmentId(s.id); }} className="flex items-center gap-2 text-[10px] font-black uppercase text-blue-500 hover:text-blue-400 transition-colors tracking-widest" title="Assign Driver">
                        <MapPin size={14} className="text-blue-500" /> Assign Driver
                      </button>
                    )}
                    
                    {!(s.open_bidding && !s.bid_id) && (
                      <button onClick={(e) => { e.stopPropagation(); setExpandedShipmentId(expandedShipmentId === s.id ? null : s.id) }} className="flex items-center gap-2 text-[10px] font-black uppercase text-emerald-500 hover:text-emerald-400 transition-colors tracking-widest" title="Live Track">
                        <Zap size={14} className="text-emerald-500" /> {expandedShipmentId === s.id ? 'Close Track' : 'Live Track'}
                      </button>
                    )}
                    
                    <button onClick={(e) => { e.stopPropagation(); setEditingShipment(s) }} className="flex items-center gap-2 text-[10px] font-black uppercase text-muted hover:text-text transition-colors tracking-widest" title="Edit">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg> Edit
                    </button>
                    <button onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteShipmentId(s.id);
                    }} className="flex items-center gap-2 text-[10px] font-black uppercase text-red-500 hover:text-red-400 transition-colors tracking-widest" title="Delete" disabled={deleteMutation.isPending}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> Delete
                    </button>
                  </div>
                </div>

                {/* Column 4: Status Intelligence */}
                <div className="p-10 h-full flex flex-col justify-center bg-surface2/30">
                  <div className="flex items-center justify-between mb-10">
                    <div className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">Status</div>
                    <div className="flex items-center gap-3">
                      <div className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse shadow-[0_0_10px_rgba(79,172,254,0.8)]" />
                      <span className="text-xs font-black text-text uppercase tracking-tighter">{s.status.replace(/_/g, ' ')}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2">
                    {['picked_up', 'in_transit', 'delivered'].map(st => (
                      <button
                        key={st}
                        onClick={(e) => { e.stopPropagation(); statusMutation.mutate({ id: s.id, status: st }) }}
                        disabled={s.status === st || statusMutation.isPending}
                        className={clsx(
                          "h-12 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all border",
                          s.status === st
                            ? "bg-primary text-bg border-primary shadow-lg shadow-primary/20"
                            : "bg-surface/50 text-muted border-border hover:border-primary/40 hover:text-text"
                        )}
                      >
                        {st.replace(/_/g, ' ')}
                      </button>
                    ))}
                  </div>
                </div>

              </div>
              
              {/* Expandable Live Tracking Map */}
              {expandedShipmentId === s.id && (
                <div className="border-t border-border bg-surface2/30 p-6 animate-in slide-in-from-top-2 duration-300">
                  <InlineTrackingMap trackingId={s.tracking_id} allVehicles={[]} />
                </div>
              )}
            </Card>
          ))
        )}
      </div>


      <EditShipmentModal shipment={editingShipment} isOpen={!!editingShipment} onClose={() => setEditingShipment(null)} />

      {/* Sleek and Compact AI Neural Routing Pipeline Overlay */}
      {neuralPipelineStep !== null && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md border border-slate-200 p-6 bg-white text-slate-900 shadow-[0_20px_50px_rgba(15,23,42,0.15)] rounded-[2rem] relative overflow-hidden">
            
            {/* Soft subtle background glow */}
            <div className="absolute top-0 right-0 w-24 h-24 bg-yellow-500/5 rounded-full blur-2xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-24 h-24 bg-blue-500/5 rounded-full blur-2xl pointer-events-none" />

            <div className="space-y-5 relative z-10">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-yellow-400 flex items-center justify-center text-slate-950 shadow-md shadow-yellow-500/10">
                    <Zap size={18} className="fill-current animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-base font-black uppercase tracking-tight text-slate-950 leading-none">Neural Route Pipeline</h3>
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-1">Autonomous Dispatch Grid</p>
                  </div>
                </div>
                <Badge variant="orange" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20 text-[8px] px-2 py-0.5">
                  {neuralPipelineStep < 4 ? 'OPTIMIZING' : 'SOLVED'}
                </Badge>
              </div>

              {/* Progress Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[8px] font-black uppercase text-slate-400 tracking-widest">
                  <span>Engine Solver Progress</span>
                  <span>{Math.round((neuralPipelineStep / 4) * 100)}%</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-yellow-500 via-amber-400 to-yellow-300 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${(neuralPipelineStep / 4) * 100}%` }}
                  />
                </div>
              </div>

              {/* Pipeline Steps */}
              <div className="space-y-2">
                {[
                  {
                    step: 1,
                    title: '1. Neural Routing Solver',
                    desc: 'Sending dispatch vector to Neural Solver models to calculate optimal paths...',
                    icon: <Layers size={14} />
                  },
                  {
                    step: 2,
                    title: '2. Route Grid Optimization',
                    desc: 'Finalizing stop sequence, total distance, weather conditions, and travel times...',
                    icon: <Navigation size={14} />
                  },
                  {
                    step: 3,
                    title: '3. Driver Interface Dispatch',
                    desc: 'Broadcasting telemetry sequence to mobile driver console & marking route active...',
                    icon: <Smartphone size={14} />
                  },
                  {
                    step: 4,
                    title: '4. AI Intel Dashboard Sync',
                    desc: 'Updating travel analytics metrics, fuel conservation levels, and dashboard KPIs...',
                    icon: <CheckCircle size={14} />
                  }
                ].map(({ step, title, desc, icon }) => {
                  const isDone = neuralPipelineStep > step || neuralPipelineStep === 4;
                  const isActive = neuralPipelineStep === step;
                  return (
                    <div 
                      key={step} 
                      className={clsx(
                        "flex gap-3 p-2.5 rounded-xl border transition-all duration-200",
                        isDone ? "bg-emerald-50/40 border-emerald-100 text-slate-800" :
                        isActive ? "bg-yellow-50/50 border-yellow-250 text-slate-950 shadow-sm" :
                        "bg-slate-50/40 border-slate-100 text-slate-400 opacity-60"
                      )}
                    >
                      <div className={clsx(
                        "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all",
                        isDone ? "bg-emerald-500 text-white" :
                        isActive ? "bg-yellow-400 text-slate-950 animate-pulse font-bold" :
                        "bg-slate-200 text-slate-500"
                      )}>
                        {isDone ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                        ) : icon}
                      </div>
                      <div className="space-y-0.5">
                        <div className={clsx("text-[10px] font-black uppercase tracking-wide", isActive ? "text-slate-900" : isDone ? "text-slate-800" : "text-slate-500")}>{title}</div>
                        <div className={clsx("text-[9px] font-medium leading-tight", isActive ? "text-slate-600" : "text-slate-400")}>{desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Action shortcuts when finished */}
              {neuralPipelineStep === 4 && (
                <div className="pt-3 border-t border-slate-100 space-y-3 animate-in slide-in-from-bottom-2 duration-300">
                  <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest text-center">
                    Navigate to Updated Platform Sectors
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => { setNeuralPipelineStep(null); navigate('/routes'); }}
                      className="h-10 bg-slate-50 hover:bg-slate-100 border border-slate-250 text-slate-800 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm"
                    >
                      🚚 Route Grid
                    </button>
                    <button 
                      onClick={() => { setNeuralPipelineStep(null); navigate('/driver'); }}
                      className="h-10 bg-slate-50 hover:bg-slate-100 border border-slate-250 text-slate-800 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm"
                    >
                      📱 Driver Console
                    </button>
                    <button 
                      onClick={() => { setNeuralPipelineStep(null); navigate('/ai-hub'); }}
                      className="h-10 bg-slate-50 hover:bg-slate-100 border border-slate-250 text-slate-800 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm"
                    >
                      🧠 AI Intel Hub
                    </button>
                    <button 
                      onClick={() => { setNeuralPipelineStep(null); navigate('/dashboard'); }}
                      className="h-10 bg-slate-50 hover:bg-slate-100 border border-slate-250 text-slate-800 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm"
                    >
                      📊 Dashboard
                    </button>
                  </div>
                  <button 
                    onClick={() => setNeuralPipelineStep(null)}
                    className="w-full h-10 bg-yellow-450 hover:bg-yellow-400 text-slate-950 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-sm active:scale-95"
                  >
                    Done & Return
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Custom Delete Confirmation Modal */}
      {confirmDeleteShipmentId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg/85 backdrop-blur-md animate-fade-in">
          <Card className="w-full max-w-md border border-border p-8 bg-surface shadow-2xl relative">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-center mx-auto text-red-500">
                <AlertTriangle size={32} />
              </div>
              <h3 className="text-2xl font-black text-text uppercase tracking-tight">Confirm Deletion</h3>
              <p className="text-muted font-bold text-sm leading-relaxed">
                Are you sure you want to delete shipment <span className="text-red-500 font-mono">{shipments.find((s: any) => s.id === confirmDeleteShipmentId)?.tracking_id}</span>? This action is permanent and cannot be undone.
              </p>
              <div className="flex gap-4 pt-4">
                <Button 
                  onClick={() => setConfirmDeleteShipmentId(null)}
                  className="flex-1 py-4 border-slate-200"
                >
                  Cancel
                </Button>
                <Button 
                  variant="danger"
                  onClick={() => {
                    deleteMutation.mutate(confirmDeleteShipmentId)
                    setConfirmDeleteShipmentId(null)
                  }}
                  className="flex-1 py-4 bg-red-500/10 border-red-500/20 text-red-500 hover:bg-red-500/20 font-black uppercase tracking-widest"
                >
                  Delete
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
      
      {assignShipmentId && (
        <AssignDriverModal
          shipmentId={assignShipmentId}
          onClose={() => setAssignShipmentId(null)}
        />
      )}
    </div>
  )
}

function EditShipmentModal({ shipment, isOpen, onClose }: { shipment: any; isOpen: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState({
    priority: shipment?.priority || 'medium',
    total_items: shipment?.total_items || 1,
    total_weight_kg: shipment?.total_weight_kg || 5.0,
  })

  useEffect(() => {
    if (shipment) {
      setFormData({
        priority: shipment.priority || 'medium',
        total_items: shipment.total_items || 1,
        total_weight_kg: shipment.total_weight_kg || 5.0,
      })
    }
  }, [shipment])

  const mutation = useMutation({
    mutationFn: (data: any) => shipmentsAPI.edit(shipment.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      toast.success('Shipment successfully updated')
      onClose()
    },
    onError: (error: any) => {
      const msg = error?.response?.data?.detail || error?.message || 'Failed to update shipment'
      toast.error(typeof msg === 'string' ? msg : JSON.stringify(msg))
    }
  })

  if (!isOpen || !shipment) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6 backdrop-blur-2xl bg-surface2/40 animate-in fade-in duration-500">
      <div className="bg-white rounded-[3rem] w-full max-w-lg shadow-[0_32px_64px_-16px_rgba(0,0,0,0.3)] border border-white/20 p-10 space-y-8 animate-in zoom-in-95 duration-500">
        <h2 className="text-3xl font-black text-text font-display tracking-tight uppercase leading-none">Edit Shipment</h2>
        <div className="space-y-4">
          <label className="text-[10px] font-black text-muted uppercase tracking-widest">Priority</label>
          <div className="flex gap-2">
            {PRIORITIES.map(p => (
              <button key={p} onClick={() => setFormData({ ...formData, priority: p })} className={clsx("px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest", formData.priority === p ? "bg-surface text-yellow-400" : "bg-slate-50 text-muted hover:bg-slate-100")}>{p}</button>
            ))}
          </div>
        </div>
        <div className="flex gap-4">
          <div className="flex-1 space-y-2">
            <label className="text-[10px] font-black text-muted uppercase tracking-widest">Total Items</label>
            <input type="number" value={formData.total_items} onChange={e => setFormData({ ...formData, total_items: parseInt(e.target.value) || 0 })} className="w-full h-12 px-4 bg-slate-50 rounded-xl text-xs font-bold focus:ring-2 focus:ring-slate-100 outline-none" />
          </div>
          <div className="flex-1 space-y-2">
            <label className="text-[10px] font-black text-muted uppercase tracking-widest">Weight (KG)</label>
            <input type="number" step="0.1" value={formData.total_weight_kg} onChange={e => setFormData({ ...formData, total_weight_kg: parseFloat(e.target.value) || 0 })} className="w-full h-12 px-4 bg-slate-50 rounded-xl text-xs font-bold focus:ring-2 focus:ring-slate-100 outline-none" />
          </div>
        </div>
        <div className="flex gap-4 pt-4">
          <Button variant="ghost" className="flex-1 h-16 rounded-[2rem] font-black uppercase tracking-widest text-xs hover:bg-red-50 hover:text-red-500" onClick={onClose}>Abort</Button>
          <Button variant="accent" className="flex-1 h-16 rounded-[2rem] font-black uppercase tracking-widest text-xs shadow-2xl shadow-yellow-500/20 bg-yellow-500 hover:bg-yellow-400 text-slate-900" onClick={() => mutation.mutate(formData)} disabled={mutation.isPending}>
            {mutation.isPending ? "Updating..." : "Update"}
          </Button>
        </div>
      </div>
    </div>
  )
}
