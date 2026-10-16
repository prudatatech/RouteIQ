import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, CheckCircle2, ChevronRight, Sparkles, Truck, Zap } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { Button, Card, CardHeader, Skeleton, StatusPill, humanize } from '@/components/ui'
import { shipmentsAPI, vehiclesAPI, vendorAPI } from '@/services/api'
import { supabase } from '@/services/supabase'
import type { Vehicle } from '@/components/fleet/types'
import { formatKg, formatRupees } from '@/utils/display'

interface OpenLoadItem {
  id: string
  kind: 'vendor' | 'shipment'
  title: string
  pickupCity: string
  dropCity: string
  weightKg: number
  priceInr?: number | null
  requiredVehicleType?: string | null
  isReefer?: boolean
  isHazmat?: boolean
}

export default function DirectLoadAllocation() {
  const queryClient = useQueryClient()
  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(null)
  const [selectedLoadId, setSelectedLoadId] = useState<string | null>(null)
  const [isAssigning, setIsAssigning] = useState(false)

  // 1. Fetch available trucks (including quick-added ones per Feature Spec)
  const trucksQuery = useQuery<Vehicle[]>({
    queryKey: ['today-direct-allocation-trucks'],
    queryFn: async () => {
      const data = await vehiclesAPI.list({ limit: 50 }) as Vehicle[]
      return (data || []).filter(v => 
        v.status !== 'archived' && 
        v.status !== 'maintenance' && 
        v.status !== 'pending_approval' &&
        !v.plate_number.startsWith('TEMP-') &&
        !v.plate_number.startsWith('DRFT-')
      )
    },
    refetchInterval: 20_000,
  })

  // 2. Fetch open upcoming loads waiting for vehicle allocation
  const loadsQuery = useQuery<OpenLoadItem[]>({
    queryKey: ['today-direct-allocation-loads'],
    queryFn: async () => {
      const items: OpenLoadItem[] = []

      // Vendor shipment requests waiting for vehicle
      const { data: vendorRequests } = await supabase
        .from('vendor_shipment_requests')
        .select('*')
        .in('status', ['pending', 'accepted', 'approved', 'open'])
        .is('assigned_vehicle_id', null)
        .order('created_at', { ascending: false })
        .limit(20)

      for (const r of vendorRequests || []) {
        const special = typeof r.special_handling === 'object' ? r.special_handling : {}
        items.push({
          id: r.id,
          kind: 'vendor',
          title: r.load_number || `VR-${r.id.slice(0, 8).toUpperCase()}`,
          pickupCity: r.pickup_city || r.pickup_location?.split(',')[0] || 'Origin',
          dropCity: r.delivery_city || r.drop_location?.split(',')[0] || 'Destination',
          weightKg: Number(r.required_capacity_kg || r.total_weight_kg) || 0,
          priceInr: r.cost ?? r.budget_inr ?? null,
          requiredVehicleType: r.vehicle_class || null,
          isReefer: r.is_reefer || r.load_type === 'reefer' || r.load_type === 'cold_chain',
          isHazmat: Boolean(special?.hazmat || r.hazmat_mixed),
        })
      }

      // Shipments waiting for vehicle
      const { data: shipments } = await supabase
        .from('shipments')
        .select('*')
        .eq('status', 'created')
        .is('current_vehicle_id', null)
        .order('created_at', { ascending: false })
        .limit(20)

      for (const s of shipments || []) {
        items.push({
          id: s.id,
          kind: 'shipment',
          title: s.tracking_id || `SH-${s.id.slice(0, 8).toUpperCase()}`,
          pickupCity: s.origin_name || 'Origin',
          dropCity: s.consignee_name || 'Destination',
          weightKg: Number(s.total_weight_kg) || 0,
          priceInr: null,
          requiredVehicleType: s.required_vehicle_type || null,
          isReefer: false,
          isHazmat: false,
        })
      }

      return items
    },
    refetchInterval: 20_000,
  })

  const trucks = trucksQuery.data || []
  const loads = loadsQuery.data || []

  const selectedTruck = trucks.find(t => t.id === selectedTruckId) || null
  const selectedLoad = loads.find(l => l.id === selectedLoadId) || null

  // 3. One-tap allocation execution
  const executeAssignment = async (truck: Vehicle, load: OpenLoadItem) => {
    // Compliance gate checks per Feature Spec
    if (load.isReefer && !truck.is_reefer && truck.body_type !== 'reefer') {
      toast.error(`Truck ${truck.plate_number} is not Reefer-certified. Add credentials in Fleet to dispatch cold-chain loads.`, {
        icon: '⚠️',
        duration: 5000,
      })
      return
    }

    if (load.isHazmat && !truck.hazmat_certified) {
      toast.error(`Truck ${truck.plate_number} is not Hazmat-certified. Compliance documents required for hazardous cargo.`, {
        icon: '⚠️',
        duration: 5000,
      })
      return
    }

    if (truck.capacity_kg && load.weightKg > truck.capacity_kg) {
      toast.error(`Load weight (${formatKg(load.weightKg)}) exceeds truck capacity (${formatKg(truck.capacity_kg)}).`, {
        icon: '⚠️',
        duration: 4000,
      })
      return
    }

    setIsAssigning(true)
    try {
      if (load.kind === 'vendor') {
        await vendorAPI.assignVehicle(load.id, { vehicle_id: truck.id })
      } else {
        await shipmentsAPI.assignDriver(load.id, truck.id, false)
      }

      toast.success(`Allocated Load ${load.title} to Truck ${truck.plate_number}!`, {
        icon: '✅',
        duration: 4000,
      })

      // Reset selection state
      setSelectedTruckId(null)
      setSelectedLoadId(null)

      // Refresh queries immediately
      queryClient.invalidateQueries({ queryKey: ['today-direct-allocation-trucks'] })
      queryClient.invalidateQueries({ queryKey: ['today-direct-allocation-loads'] })
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] })
      queryClient.invalidateQueries({ queryKey: ['ops-today'] })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail
        || (err as { message?: string })?.message
        || 'Failed to allocate vehicle'
      toast.error(msg)
    } finally {
      setIsAssigning(false)
    }
  }

  // 4. Handle Truck Tap
  const handleTruckClick = (truck: Vehicle) => {
    if (selectedLoad) {
      // Load was already selected -> complete allocation immediately!
      executeAssignment(truck, selectedLoad)
    } else {
      // Toggle truck selection
      setSelectedTruckId(prev => (prev === truck.id ? null : truck.id))
    }
  }

  // 5. Handle Load Tap
  const handleLoadClick = (load: OpenLoadItem) => {
    if (selectedTruck) {
      // Truck was already selected -> complete allocation immediately!
      executeAssignment(selectedTruck, load)
    } else {
      // Toggle load selection
      setSelectedLoadId(prev => (prev === load.id ? null : load.id))
    }
  }

  return (
    <Card className="overflow-hidden border border-border/80">
      <CardHeader
        title="Direct Load Allocation"
        description="Tap a truck, then tap a load — or tap a load, then tap a truck. Instant 1-tap direct assignment from Home."
        actions={
          <div className="flex items-center gap-2">
            {(selectedTruckId || selectedLoadId) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedTruckId(null)
                  setSelectedLoadId(null)
                }}
              >
                Clear selection
              </Button>
            )}
            <span className="flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand">
              <Zap size={14} className="animate-pulse" />
              <span>One-Tap Assign</span>
            </span>
          </div>
        }
      />

      <div className="grid grid-cols-1 divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        {/* Left Column: Fleet Capacity */}
        <div className="flex flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-medium text-text">
              <Truck size={16} className="text-brand" />
              <span>Your Trucks ({trucks.length})</span>
            </div>
            {selectedTruck && (
              <span className="text-xs font-semibold text-brand">
                Selected: {selectedTruck.plate_number} (Now tap a load to allocate)
              </span>
            )}
          </div>

          {trucksQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-16 rounded-card" />)}
            </div>
          ) : trucks.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted">
              No available trucks found in fleet. Quick-add a truck to assign loads.
            </div>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {trucks.map(truck => {
                const isSelected = selectedTruckId === truck.id
                return (
                  <button
                    key={truck.id}
                    type="button"
                    disabled={isAssigning}
                    onClick={() => handleTruckClick(truck)}
                    className={clsx(
                      'group flex w-full items-center justify-between rounded-card border p-3 text-left transition-all',
                      isSelected
                        ? 'border-brand bg-brand-soft ring-2 ring-brand/30'
                        : 'border-border bg-surface hover:border-brand/40 hover:bg-surface-subtle',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-text group-hover:text-brand">
                          {truck.plate_number}
                        </span>
                        {truck.profile_status === 'quick_added' && (
                          <StatusPill tone="warning" dot={false}>Quick Added</StatusPill>
                        )}
                        {truck.profile_status === 'pending_documents' && (
                          <StatusPill tone="warning" dot={false}>Pending Docs</StatusPill>
                        )}
                        {truck.profile_status === 'complete' && (
                          <StatusPill tone="success" dot={false}>Fully Verified</StatusPill>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                        <span>{humanize(truck.vehicle_type)}</span>
                        {truck.body_type && <span>· {humanize(truck.body_type)}</span>}
                        {truck.capacity_kg ? <span>· {formatKg(truck.capacity_kg)}</span> : null}
                        {truck.driver_name ? (
                          <span className="text-text">· Driver: {truck.driver_name}</span>
                        ) : (
                          <span className="italic text-muted">· No driver</span>
                        )}
                      </div>
                    </div>

                    <div className="ml-3 shrink-0">
                      {isSelected ? (
                        <CheckCircle2 size={18} className="text-brand" />
                      ) : (
                        <div className="flex items-center text-xs text-muted group-hover:text-brand">
                          <span>{selectedLoad ? 'Assign this' : 'Select'}</span>
                          <ChevronRight size={14} />
                        </div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Right Column: Open / Upcoming Loads */}
        <div className="flex flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-medium text-text">
              <Sparkles size={16} className="text-brand" />
              <span>Open & Upcoming Loads ({loads.length})</span>
            </div>
            {selectedLoad && (
              <span className="text-xs font-semibold text-brand">
                Selected: {selectedLoad.title} (Now tap a truck to allocate)
              </span>
            )}
          </div>

          {loadsQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-16 rounded-card" />)}
            </div>
          ) : loads.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted">
              No open loads waiting for vehicle allocation right now.
            </div>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {loads.map(load => {
                const isSelected = selectedLoadId === load.id
                return (
                  <button
                    key={load.id}
                    type="button"
                    disabled={isAssigning}
                    onClick={() => handleLoadClick(load)}
                    className={clsx(
                      'group flex w-full items-center justify-between rounded-card border p-3 text-left transition-all',
                      isSelected
                        ? 'border-brand bg-brand-soft ring-2 ring-brand/30'
                        : 'border-border bg-surface hover:border-brand/40 hover:bg-surface-subtle',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium text-brand">
                          {load.title}
                        </span>
                        {load.isReefer && (
                          <span className="rounded bg-info-soft px-1.5 py-0.5 text-xs font-medium text-info">
                            Reefer
                          </span>
                        )}
                        {load.isHazmat && (
                          <span className="rounded bg-danger-soft px-1.5 py-0.5 text-xs font-medium text-danger">
                            Hazmat
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-xs font-medium text-text">
                        <span className="truncate">{load.pickupCity}</span>
                        <ArrowRight size={12} className="shrink-0 text-muted" />
                        <span className="truncate">{load.dropCity}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                        <span>{formatKg(load.weightKg)}</span>
                        {load.priceInr && (
                          <span className="font-semibold text-text">· {formatRupees(load.priceInr)}</span>
                        )}
                      </div>
                    </div>

                    <div className="ml-3 shrink-0">
                      {isSelected ? (
                        <CheckCircle2 size={18} className="text-brand" />
                      ) : (
                        <div className="flex items-center text-xs text-muted group-hover:text-brand">
                          <span>{selectedTruck ? 'Put on truck' : 'Select'}</span>
                          <ChevronRight size={14} />
                        </div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
