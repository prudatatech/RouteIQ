import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Package, Minus, X, Navigation, MapPin, Search, Loader2, Scale, Ruler, Layers, Zap, Smartphone, Calendar, Clock, Radio } from 'lucide-react';
import { Button, Badge } from '@/components/ui';
import LiveMap from '@/components/map/LiveMap';
import { shipmentsAPI, telemetryAPI, vehiclesAPI, capacityAPI } from '@/services/api';
import { useDraftStore } from '@/store/draftStore';

const PRIORITIES = ['low', 'medium', 'high', 'critical'];

const CARGO_ARCHETYPES = [
  { id: 'standard', name: 'Standard Parcel', desc: 'Secure express delivery', icon: '/assets/cargo/parcel.png' },
  { id: 'heavy', name: 'Heavy Freight', desc: 'Industrial bulk cargo', icon: '/assets/cargo/freight.png' },
  { id: 'cold_chain', name: 'Cold Chain', desc: 'Temp-sensitive items', icon: '/assets/cargo/cold_chain.png' },
  { id: 'hazardous', name: 'Hazardous', desc: 'Special handling reqs', icon: '/assets/cargo/hazardous.png' },
]



export default function AddShipmentModal() {
  const { isModalOpen, isMinimized, formData, setFormData, minimizeModal, expandModal, closeModal, clearDraft } = useDraftStore();
  const queryClient = useQueryClient()
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [isSearching, setIsSearching] = useState(false)



  // State for origin search
  const [originSuggestions, setOriginSuggestions] = useState<any[]>([])
  const [isSearchingOrigin, setIsSearchingOrigin] = useState(false)

  // Nearby vendors for bidding
  const [nearbyVendors, setNearbyVendors] = useState<any[]>([])
  const [isLoadingVendors, setIsLoadingVendors] = useState(false)

  useEffect(() => {
    if (formData.open_bidding && formData.origin_lat && formData.origin_lng) {
      const fetchVendors = async () => {
        setIsLoadingVendors(true);
        try {
          const data = await capacityAPI.getNearbyVendors({ lat: formData.origin_lat, lng: formData.origin_lng, radius: 50 });
          setNearbyVendors(data);
        } catch (e) {
          console.error('Failed to fetch nearby vendors', e);
        } finally {
          setIsLoadingVendors(false);
        }
      };
      fetchVendors();
    } else {
      setNearbyVendors([]);
    }
  }, [formData.open_bidding, formData.origin_lat, formData.origin_lng]);

  // Mobile GPS state
  const [mobileLink, setMobileLink] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)
  const [generatingLink, setGeneratingLink] = useState(false)

  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => vehiclesAPI.list(),
  })

  // Sort vehicles by distance to origin
  const sortedVehicles = useMemo(() => {
    if (!formData.origin_lat || !formData.origin_lng) return vehicles;

    const toRad = (value: number) => (value * Math.PI) / 180;
    const calcDist = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371; // km
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    return [...vehicles].map((v: any) => {
      if (v.latitude && v.longitude) {
        return { ...v, distance_km: calcDist(formData.origin_lat, formData.origin_lng, v.latitude, v.longitude) }
      }
      return { ...v, distance_km: 999999 }
    }).sort((a, b) => a.distance_km - b.distance_km);
  }, [vehicles, formData.origin_lat, formData.origin_lng]);

  const handleDriverSelection = async (id: string) => {
    const driverVehicle = sortedVehicles.find((v: any) => v.id === id)
    if (!driverVehicle) return;

    setFormData((prev: any) => ({ ...prev, selectedVehicleId: id }))
    
    if (driverVehicle.latitude && driverVehicle.longitude) {
      // Optimistic update
      setFormData((prev: any) => ({
        ...prev,
        origin_name: 'Driver Current Location',
        origin_address: `Lat: ${driverVehicle.latitude.toFixed(4)}, Lng: ${driverVehicle.longitude.toFixed(4)}`,
        origin_lat: driverVehicle.latitude,
        origin_lng: driverVehicle.longitude
      }))
      toast.success(`Selected driver ${driverVehicle.plate_number}`)

      try {
        const token = import.meta.env.VITE_MAPBOX_TOKEN
        const geocodingBase = import.meta.env.VITE_MAPBOX_GEOCODING_URL || 'https://api.mapbox.com/geocoding/v5/mapbox.places'
        const resp = await axios.get(
          `${geocodingBase}/${driverVehicle.longitude},${driverVehicle.latitude}.json`,
          {
            params: { access_token: token, limit: 1 }
          }
        )
        const place = resp.data.features?.[0]
        if (place) {
          setFormData((prev: any) => ({
            ...prev,
            origin_name: place.text || 'Assigned Driver Location',
            origin_address: place.place_name || place.text,
          }))
        }
      } catch (err) {
        console.error('Reverse geocoding failed', err)
      }
    } else {
      toast.success(`Selected driver ${driverVehicle.plate_number}`)
    }
  }

  const generateMobileLink = async () => {
    if (!formData.selectedVehicleId) { toast.error('Select a vehicle first'); return }
    setGeneratingLink(true)
    try {
      const result = await telemetryAPI.createMobileSession(formData.selectedVehicleId, formData.mobilePhone)
      const url = `${window.location.origin}/m/${result.token}`
      setMobileLink(url)
      toast.success(`Tracking link generated for ${result.plate}`)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Failed to generate link')
    } finally {
      setGeneratingLink(false)
    }
  }

  const copyLink = () => {
    navigator.clipboard.writeText(mobileLink)
    setLinkCopied(true)
    toast.success('Link copied!')
    setTimeout(() => setLinkCopied(false), 2000)
  }

  const shareWhatsApp = () => {
    const msg = encodeURIComponent(`📍 margixindia GPS Tracking Link\nVehicle tracking is live. Open this link on your phone to start sharing location:\n${mobileLink}`)
    window.open(`https://wa.me/${formData.mobilePhone.replace(/\D/g, '')}?text=${msg}`, '_blank')
  }

  useEffect(() => {
    const searchMapbox = async (query: string, setter: (val: any[]) => void, loadingSetter: (val: boolean) => void) => {
      if (query.length < 3) {
        setter([])
        return
      }
      loadingSetter(true)
      try {
        const token = import.meta.env.VITE_MAPBOX_TOKEN
        const geocodingBase = import.meta.env.VITE_MAPBOX_GEOCODING_URL || 'https://api.mapbox.com/geocoding/v5/mapbox.places'
        const resp = await axios.get(
          `${geocodingBase}/${encodeURIComponent(query)}.json`,
          {
            params: {
              access_token: token,
              country: 'IN',
              limit: 5,
              types: 'place,locality,address'
            }
          }
        )
        setter(resp.data.features || [])
      } catch (err) {
        console.error('Search failed', err)
      } finally {
        loadingSetter(false)
      }
    }

    const timerDest = setTimeout(() => searchMapbox(formData.searchTerm, setSuggestions, setIsSearching), 500)
    const timerOrigin = setTimeout(() => searchMapbox(formData.originSearch, setOriginSuggestions, setIsSearchingOrigin), 500)

    return () => {
      clearTimeout(timerDest)
      clearTimeout(timerOrigin)
    }
  }, [formData.searchTerm, formData.originSearch])

  const mutation = useMutation({
    mutationFn: (data: any) => {
      const payload = {
        delivery_point_id: data.delivery_point_id,
        dest_name: data.delivery_point_name,
        dest_address: data.delivery_point_address,
        dest_lat: data.dest_lat,
        dest_lng: data.dest_lng,
        origin_name: data.origin_name,
        origin_address: data.origin_address,
        origin_lat: data.origin_lat,
        origin_lng: data.origin_lng,
        total_items: Number(data.total_items),
        total_weight_kg: Number(data.total_weight_kg),
        declared_load_kg: Math.max(Number(data.total_weight_kg), (Number(data.length_cm) * Number(data.width_cm) * Number(data.height_cm)) / 5000),
        priority: data.priority,
        enable_mobile_gps: data.enable_mobile_gps,
        vehicle_id: data.selectedVehicleId || null,
        parcels: [{
          weight_kg: Number(data.total_weight_kg),
          length_cm: Number(data.length_cm),
          width_cm: Number(data.width_cm),
          height_cm: Number(data.height_cm),
          category: data.cargo_type,
          is_hazardous: data.cargo_type === 'hazardous',
          is_fragile: data.cargo_type === 'fragile'
        }],
        open_bidding: data.open_bidding,
        bidding_opens_at: data.open_bidding ? new Date().toISOString() : null,
        bidding_closes_at: data.open_bidding ? new Date(Date.now() + (data.bidding_duration_mins || 5) * 60000).toISOString() : null,
        asking_price: data.open_bidding ? (data.asking_price ? Number(data.asking_price) : null) : null,
        metadata: {
          dispatch_date: data.plan_for_later && data.scheduled_date ? data.scheduled_date : new Date().toISOString().split('T')[0],
          productCategory: data.cargo_type === 'standard' ? 'Standard Parcel' : 
                           data.cargo_type === 'heavy' ? 'Heavy Freight' :
                           data.cargo_type === 'cold_chain' ? 'Cold Chain' :
                           data.cargo_type === 'hazardous' ? 'Hazardous' : 'General Cargo',
          noOfPackages: String(data.total_items),
          grossWeight: `${data.total_weight_kg} KG`,
          transporter_signature: data.selectedVehicleId ? 'Auto-Signed at Dispatch' : null,
          eta_details: (() => {
            if (!data.origin_lat || !data.dest_lat) return { distance_km: null, eta_text: null };
            const toRad = (value: number) => (value * Math.PI) / 180;
            const R = 6371;
            const dLat = toRad(data.dest_lat - data.origin_lat);
            const dLon = toRad(data.dest_lng - data.origin_lng);
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(data.origin_lat)) * Math.cos(toRad(data.dest_lat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const hrs = dist / 40;
            const etaDate = new Date();
            etaDate.setHours(etaDate.getHours() + hrs);
            return {
              distance_km: dist.toFixed(1),
              eta_text: `${etaDate.toISOString().split('T')[0]} (Est.)`
            };
          })(),
          specialHandling: {
            fragile: data.cargo_type === 'standard',
            hazardous: data.cargo_type === 'hazardous',
            coldChain: data.cargo_type === 'cold_chain',
            stackable: true,
            highValue: data.priority === 'high' || data.priority === 'critical',
            longHaul: false
          }
        }
      }
      return shipmentsAPI.create(payload)
    },
    onSuccess: (data: any) => {
      clearDraft()
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      toast.success('Shipment successfully initialized')
      closeModal()

      // Dispatch custom event for neural pipeline trigger on ShipmentsPage
      window.dispatchEvent(new CustomEvent('shipmentCreated', { detail: data }))
    },
    onError: (error: any) => {
      const msg = error?.response?.data?.detail || error?.message || 'Failed to create shipment'
      toast.error(typeof msg === 'string' ? msg : JSON.stringify(msg))
      console.error('Shipment create error:', error?.response?.data || error)
    }
  })

  if (!isModalOpen) return null

  if (isMinimized) {
    return (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-4 bg-slate-900 text-white px-6 py-4 rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-slate-700 animate-in slide-in-from-bottom-10 duration-300">
        <Package size={22} className="text-yellow-400" />
        <div className="flex flex-col pr-4">
          <span className="text-xs font-black uppercase tracking-widest">Draft Shipment</span>
          <span className="text-[10px] text-slate-400 font-bold truncate max-w-[200px]">
            {formData.origin_name || formData.originSearch || 'No origin'} → {formData.delivery_point_name || formData.searchTerm || 'No destination'}
          </span>
        </div>
        <div className="w-px h-8 bg-slate-700 mx-2" />
        <button onClick={expandModal} className="text-xs font-black hover:text-yellow-400 uppercase tracking-widest transition-colors py-2 px-3 rounded-full hover:bg-slate-800">
          Expand
        </button>
        <button onClick={closeModal} className="w-8 h-8 rounded-full hover:bg-red-500/20 text-slate-400 hover:text-red-400 flex items-center justify-center transition-colors">
          <X size={16} />
        </button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6 backdrop-blur-2xl bg-surface2/40 animate-in fade-in duration-500">
      <div className="bg-white rounded-[3rem] w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-[0_32px_64px_-16px_rgba(0,0,0,0.3)] border border-white/20 animate-in zoom-in-95 duration-500 scrollbar-none relative">

        {/* Header with Visual Treatment */}
        <div className="relative p-10 bg-surface overflow-hidden">
          <div className="absolute top-6 right-6 z-20 flex items-center gap-2">
            <button onClick={minimizeModal} className="w-10 h-10 rounded-full bg-slate-200/50 hover:bg-slate-200 flex items-center justify-center text-slate-700 transition-colors shadow-sm">
              <Minus size={18} />
            </button>
            <button onClick={closeModal} className="w-10 h-10 rounded-full bg-slate-200/50 hover:bg-red-500/10 hover:text-red-600 flex items-center justify-center text-slate-700 transition-colors shadow-sm">
              <X size={18} />
            </button>
          </div>
          <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/20 to-transparent pointer-events-none" />
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-yellow-500 flex items-center justify-center shadow-lg shadow-yellow-500/20">
                <Package className="text-slate-900" size={20} />
              </div>
              <Badge variant="orange" className="h-6">LIVE NEURAL GRID</Badge>
            </div>
            <h2 className="text-4xl font-black text-text font-display tracking-tight uppercase leading-none mb-2">Request Shipment</h2>
            <p className="text-muted font-bold text-sm tracking-tight">Deploying cargo onto the active pan-India logistics network.</p>
          </div>

          {/* Decorative Illustration (Abstract Map Element) */}
          <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-yellow-500/10 rounded-full blur-3xl" />
        </div>

        <div className="p-10 space-y-10">

          {/* Dispatch Mode: Direct vs Bidding */}
          <div className="border border-slate-200 p-6 rounded-3xl bg-slate-50/50 shadow-sm">
            <label className="text-[10px] font-black text-muted uppercase tracking-widest pl-1 mb-3 block">Dispatch Mode</label>

            <div className="flex bg-white p-1 rounded-2xl border border-slate-200">
              <button
                onClick={() => setFormData({ ...formData, open_bidding: false })}
                className={clsx(
                  "flex-1 py-3 text-xs font-black uppercase tracking-widest rounded-xl transition-all",
                  !formData.open_bidding ? "bg-slate-900 text-white shadow-sm" : "text-muted hover:bg-slate-50"
                )}
              >
                Direct Order
              </button>
              <button
                onClick={() => setFormData({ ...formData, open_bidding: true, bidding_duration_mins: formData.bidding_duration_mins || 5, enable_mobile_gps: true })}
                className={clsx(
                  "flex-1 py-3 text-xs font-black uppercase tracking-widest rounded-xl transition-all",
                  formData.open_bidding ? "bg-primary text-slate-900 shadow-sm border border-primary/20" : "text-muted hover:bg-slate-50"
                )}
              >
                Vendor Bidding
              </button>
            </div>

            {formData.open_bidding && (
              <div className="mt-4 p-5 bg-white border border-primary/20 rounded-2xl animate-in slide-in-from-right-4 duration-300 shadow-lg shadow-primary/5">
                <div className="flex items-center gap-2 mb-4">
                  <Radio className="text-primary animate-pulse" size={16} />
                  <p className="text-[10px] font-black text-slate-900 uppercase tracking-widest">
                    Broadcasting to vendors within 50km
                  </p>
                </div>

                {!formData.selectedVehicleId && (
                  <div className="mb-4 text-[10px] font-bold text-red-500 uppercase tracking-widest bg-red-50 p-2 rounded-lg border border-red-100">
                    * Please scroll down and Assign a Driver first
                  </div>
                )}

                <div className="mb-4 flex gap-4">
                  <div className="flex-[2]">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Window Duration</label>
                    <div className="flex gap-2">
                      {[5, 10, 15, 30].map(mins => (
                        <button
                          key={mins}
                          onClick={() => setFormData({ ...formData, bidding_duration_mins: mins })}
                          className={clsx(
                            "flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all border",
                            formData.bidding_duration_mins === mins ? "bg-primary text-slate-900 border-primary shadow-sm" : "bg-slate-50 text-slate-600 border-slate-200 hover:border-primary/50"
                          )}
                        >
                          {mins}M
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Asking Price (₹)</label>
                    <input
                      type="number"
                      placeholder="e.g. 500"
                      value={formData.asking_price || ''}
                      onChange={(e) => setFormData({ ...formData, asking_price: e.target.value })}
                      className="w-full h-11 bg-slate-50 border border-slate-200 rounded-xl px-3 text-sm font-bold text-slate-900 focus:bg-white focus:border-primary/50 focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    />
                  </div>
                </div>

                <div className="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Available Broadcast Capacity</span>
                  <span className={clsx("text-xs font-black", formData.selectedVehicleId ? "text-slate-900" : "text-red-500")}>
                    {formData.selectedVehicleId ? (() => {
                      const vehicle = sortedVehicles.find((v: any) => v.id === formData.selectedVehicleId);
                      const vehicleCap = vehicle?.available_capacity_kg ?? vehicle?.capacity_kg ?? 0;
                      return vehicleCap.toFixed(1) + " KG";
                    })() : "Select Vehicle First"}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Origin Search */}
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-black text-muted uppercase tracking-widest pl-1 flex items-center gap-2">
                  <Navigation size={12} className="text-blue-500" /> Departure Point
                </label>
              </div>
              <div className="relative group">
                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-muted">
                  {isSearchingOrigin ? <Loader2 size={18} className="animate-spin text-blue-500" /> : <MapPin size={18} />}
                </div>
                <input
                  placeholder="Where is the pickup?"
                  value={formData.originSearch || formData.origin_name}
                  onChange={(e) => {
                    setFormData((prev: any) => ({ ...prev, originSearch: e.target.value, ...(prev.origin_name ? { origin_name: '', origin_address: '' } : {}) }))
                  }}
                  className="w-full h-14 pl-14 pr-6 bg-slate-50 border-2 border-transparent rounded-2xl text-slate-900 font-bold placeholder:text-muted focus:bg-white focus:border-blue-500/30 transition-all outline-none text-sm"
                />
                {originSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-2 z-[60] bg-white rounded-2xl border border-slate-100 shadow-2xl overflow-hidden">
                    {originSuggestions.map((p: any) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setFormData({
                            ...formData,
                            origin_name: p.text,
                            origin_address: p.place_name,
                            origin_lat: p.center[1],
                            origin_lng: p.center[0],
                            originSearch: ''
                          })
                          setOriginSuggestions([])
                        }}
                        className="w-full px-5 py-3 text-left hover:bg-slate-50 flex flex-col gap-0.5"
                      >
                        <span className="text-xs font-black text-slate-900">{p.text}</span>
                        <span className="text-[9px] font-bold text-muted uppercase truncate">{p.place_name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Nearby Vendors Display */}
              {formData.open_bidding && formData.origin_lat && (
                <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-2xl animate-in fade-in duration-300">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                      <Radio size={12} className={isLoadingVendors ? "animate-spin text-primary" : "text-primary"} />
                      Nearby Vendors (50km)
                    </label>
                    <Badge className="text-[8px] bg-white text-slate-500 shadow-sm border border-slate-200">{nearbyVendors.length} Found</Badge>
                  </div>

                  {isLoadingVendors ? (
                    <div className="flex items-center justify-center p-4">
                      <Loader2 size={16} className="animate-spin text-slate-400" />
                    </div>
                  ) : nearbyVendors.length > 0 ? (
                    <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-2">
                      {nearbyVendors.map((vendor, i) => (
                        <div key={i} className="flex items-center justify-between p-2 bg-white rounded-xl border border-slate-100 shadow-sm">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-black text-slate-900">{vendor.company_name || 'Vendor'}</span>
                            <span className="text-[8px] font-bold text-slate-500 uppercase">{vendor.city || 'Unknown City'}</span>
                          </div>
                          <Badge variant={vendor.distance_km < 10 ? 'green' : 'orange'} className="text-[9px]">
                            {vendor.distance_km.toFixed(1)} km
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center p-3 text-[10px] font-bold text-slate-400 bg-white rounded-xl border border-slate-100">
                      No vendors found nearby
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Destination Search */}
            {!formData.open_bidding && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-black text-muted uppercase tracking-widest pl-1 flex items-center gap-2">
                    <MapPin size={12} className="text-yellow-500" /> Goal Destination
                  </label>
                </div>
                <div className="relative group">
                  <div className="absolute left-6 top-1/2 -translate-y-1/2 text-muted">
                    {isSearching ? <Loader2 size={18} className="animate-spin text-yellow-500" /> : <Search size={18} />}
                  </div>
                  <input
                    placeholder="Final drop destination?"
                    value={formData.searchTerm || formData.delivery_point_name}
                    onChange={(e) => {
                      setFormData((prev: any) => ({ ...prev, searchTerm: e.target.value, ...(prev.delivery_point_name ? { delivery_point_name: '', delivery_point_id: '' } : {}) }))
                    }}
                    className="w-full h-14 pl-14 pr-6 bg-slate-50 border-2 border-transparent rounded-2xl text-slate-900 font-bold placeholder:text-muted focus:bg-white focus:border-yellow-500/30 transition-all outline-none text-sm"
                  />
                  {suggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-2 z-[60] bg-white rounded-2xl border border-slate-100 shadow-2xl overflow-hidden">
                      {suggestions.map((p: any) => (
                        <button
                          key={p.id}
                          onClick={() => {
                            setFormData({
                              ...formData,
                              delivery_point_id: p.id,
                              delivery_point_name: p.text,
                              delivery_point_address: p.place_name,
                              dest_lat: p.center[1],
                              dest_lng: p.center[0],
                              searchTerm: ''
                            })
                            setSuggestions([])
                          }}
                          className="w-full px-5 py-3 text-left hover:bg-slate-50 flex flex-col gap-0.5"
                        >
                          <span className="text-xs font-black text-slate-900">{p.text}</span>
                          <span className="text-[9px] font-bold text-muted uppercase truncate">{p.place_name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Cargo Payload (requested) */}
          <div className="space-y-4">
            <label className="text-[10px] font-black text-muted uppercase tracking-widest pl-1">Cargo Payload Configuration</label>
            <div className="flex gap-4">
              <div className="flex-1 space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">Total Items</label>
                <div className="relative">
                  <Package size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="number"
                    placeholder="e.g. 5"
                    min="1"
                    value={formData.total_items || ''}
                    onChange={(e) => setFormData({ ...formData, total_items: parseInt(e.target.value) || 0 })}
                    className="w-full h-14 pl-12 bg-slate-50 rounded-2xl text-xs font-bold focus:ring-2 focus:ring-slate-200 outline-none"
                  />
                </div>
              </div>
              <div className="flex-1 space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">Total Weight (KG)</label>
                <div className="relative">
                  <Scale size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="number"
                    placeholder="e.g. 1500"
                    min="0.1"
                    step="0.1"
                    value={formData.total_weight_kg || ''}
                    onChange={(e) => setFormData({ ...formData, total_weight_kg: parseFloat(e.target.value) || 0 })}
                    className="w-full h-14 pl-12 bg-slate-50 rounded-2xl text-xs font-bold focus:ring-2 focus:ring-slate-200 outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-4 mt-4">
              <div className="flex-1 space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">Length (cm)</label>
                <div className="relative">
                  <Ruler size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="number"
                    placeholder="L"
                    min="1"
                    value={formData.length_cm || ''}
                    onChange={(e) => setFormData({ ...formData, length_cm: parseInt(e.target.value) || 0 })}
                    className="w-full h-14 pl-10 pr-2 bg-slate-50 rounded-2xl text-xs font-bold focus:ring-2 focus:ring-slate-200 outline-none"
                  />
                </div>
              </div>
              <div className="flex-1 space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">Width (cm)</label>
                <div className="relative">
                  <Ruler size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="number"
                    placeholder="W"
                    min="1"
                    value={formData.width_cm || ''}
                    onChange={(e) => setFormData({ ...formData, width_cm: parseInt(e.target.value) || 0 })}
                    className="w-full h-14 pl-10 pr-2 bg-slate-50 rounded-2xl text-xs font-bold focus:ring-2 focus:ring-slate-200 outline-none"
                  />
                </div>
              </div>
              <div className="flex-1 space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">Height (cm)</label>
                <div className="relative">
                  <Ruler size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="number"
                    placeholder="H"
                    min="1"
                    value={formData.height_cm || ''}
                    onChange={(e) => setFormData({ ...formData, height_cm: parseInt(e.target.value) || 0 })}
                    className="w-full h-14 pl-10 pr-2 bg-slate-50 rounded-2xl text-xs font-bold focus:ring-2 focus:ring-slate-200 outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="mt-2 bg-yellow-500/10 p-3 rounded-xl border border-yellow-500/30">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black uppercase text-yellow-700 tracking-widest">Calculated Capacity</span>
                <span className="text-xs font-black text-yellow-800">
                  {Math.max(formData.total_weight_kg || 0, ((formData.length_cm || 0) * (formData.width_cm || 0) * (formData.height_cm || 0)) / 5000).toFixed(1)} KG
                </span>
              </div>
              <div className="flex justify-between items-center mt-1 text-[9px] font-bold text-yellow-600/70">
                <span>Physical: {formData.total_weight_kg || 0} kg</span>
                <span>Volumetric: {(((formData.length_cm || 0) * (formData.width_cm || 0) * (formData.height_cm || 0)) / 5000).toFixed(1)} kg</span>
              </div>
            </div>
          </div>

          {/* Section 2: Cargo Archetypes (Image 3 style) */}
          <div className="space-y-4">
            <label className="text-[10px] font-black text-muted uppercase tracking-widest pl-1 flex items-center gap-2">
              <Layers size={12} className="text-muted" /> Shipment Intelligence
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {CARGO_ARCHETYPES.map(cargo => (
                <button
                  key={cargo.id}
                  onClick={() => setFormData({ ...formData, cargo_type: cargo.id })}
                  className={clsx(
                    "relative p-5 rounded-[2rem] border-2 text-left transition-all group overflow-hidden",
                    formData.cargo_type === cargo.id
                      ? "bg-surface border-slate-900 shadow-xl shadow-slate-900/10"
                      : "bg-white border-slate-100 hover:border-yellow-500/30"
                  )}
                >
                  <div className="flex items-center gap-4 relative z-10">
                    <div className={clsx(
                      "w-14 h-14 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110",
                      formData.cargo_type === cargo.id ? "bg-surface2" : "bg-slate-50"
                    )}>
                      <img src={cargo.icon} alt="" className="w-10 h-10 object-contain drop-shadow-xl" />
                    </div>
                    <div>
                      <div className={clsx(
                        "text-sm font-black uppercase tracking-tight",
                        formData.cargo_type === cargo.id ? "text-yellow-400" : "text-slate-900"
                      )}>{cargo.name}</div>
                      <div className={clsx(
                        "text-[10px] font-bold",
                        formData.cargo_type === cargo.id ? "text-muted" : "text-muted"
                      )}>{cargo.desc}</div>
                    </div>
                  </div>
                  {formData.cargo_type === cargo.id && (
                    <Zap size={40} className="absolute -right-4 -bottom-4 text-text/5 rotate-12" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Section 3: Priority & Plan for Later (Image 4 style) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <label className="text-[10px] font-black text-muted uppercase tracking-widest pl-1">Priority Grid</label>
              <div className="flex flex-wrap gap-2">
                {PRIORITIES.map(p => (
                  <button
                    key={p}
                    onClick={() => setFormData({ ...formData, priority: p })}
                    className={clsx(
                      "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                      formData.priority === p ? "bg-surface text-yellow-400" : "bg-slate-50 text-muted hover:bg-slate-100"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              {/* Driver Assignment & Tracking */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-[10px] font-black text-muted uppercase tracking-widest pl-1">Assign Driver</label>
                  <p className="text-[9px] text-yellow-600 font-bold pl-1 mt-0.5">Select from map to instantly assign</p>
                </div>
                <button
                  onClick={() => setFormData({ ...formData, enable_mobile_gps: !formData.enable_mobile_gps })}
                  className={clsx(
                    "relative w-10 h-6 rounded-full transition-colors",
                    formData.enable_mobile_gps ? "bg-yellow-500" : "bg-slate-200"
                  )}
                >
                  <div className={clsx(
                    "absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform shadow-sm",
                    formData.enable_mobile_gps ? "translate-x-4" : "translate-x-0"
                  )} />
                </button>
              </div>

              {formData.enable_mobile_gps && (
                <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Smartphone size={14} className="text-yellow-600" />
                      <p className="text-[9px] font-black text-yellow-700 uppercase tracking-widest">Select Driver (Map)</p>
                    </div>
                  </div>

                  <div className="h-64 w-full rounded-xl overflow-hidden border border-slate-200">
                    <LiveMap
                      vehicles={sortedVehicles}
                      selectedVehicleId={formData.selectedVehicleId}
                      onVehicleSelect={handleDriverSelection}
                    />
                  </div>

                  {/* Vehicle selector fallback */}
                  <div>
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Or select manually</label>
                    <select
                      value={formData.selectedVehicleId}
                      onChange={e => handleDriverSelection(e.target.value)}
                      className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl text-[11px] font-bold text-slate-800 focus:ring-2 focus:ring-yellow-500/30 focus:outline-none"
                    >
                      <option value="">-- Choose vehicle --</option>
                      {(sortedVehicles as any[]).map((v: any) => (
                        <option key={v.id} value={v.id}>
                          {v.plate_number} · {v.distance_km && v.distance_km !== 999999 ? `${v.distance_km.toFixed(1)}km away · ` : ''}Free: {v.available_capacity_kg ?? v.capacity_kg}kg / {v.capacity_kg}kg
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <input
                      type="tel"
                      placeholder="Driver phone number"
                      value={formData.mobilePhone || ''}
                      onChange={e => setFormData((prev: any) => ({ ...prev, mobilePhone: e.target.value }))}
                      className="flex-1 h-12 bg-white border border-slate-200 rounded-xl px-4 text-xs font-bold focus:border-yellow-500/50 outline-none"
                    />
                    <Button
                      variant="ghost"
                      onClick={generateMobileLink}
                      disabled={generatingLink || !formData.mobilePhone || !formData.selectedVehicleId}
                      className="bg-slate-100 hover:bg-slate-200"
                    >
                      Link
                    </Button>
                  </div>
                </div>
              )}


              {/* Plan For Later Toggle */}
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-black text-muted uppercase tracking-widest pl-1">Plan For Later</label>
                <button
                  onClick={() => setFormData({ ...formData, plan_for_later: !formData.plan_for_later })}
                  className={clsx(
                    "relative w-10 h-6 rounded-full transition-colors",
                    formData.plan_for_later ? "bg-yellow-500" : "bg-slate-200"
                  )}
                >
                  <div className={clsx(
                    "absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform shadow-sm",
                    formData.plan_for_later ? "translate-x-4" : "translate-x-0"
                  )} />
                </button>
              </div>

              {formData.plan_for_later && (
                <div className="flex gap-2 animate-in slide-in-from-right-4 duration-300">
                  <div className="relative flex-1 group">
                    <Calendar size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted group-focus-within:text-yellow-500" />
                    <input
                      type="date"
                      className="w-full h-12 pl-10 pr-3 bg-slate-50 border-none rounded-xl text-[10px] font-bold text-slate-900 focus:ring-2 focus:ring-yellow-500/20"
                      onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })}
                    />
                  </div>
                  <div className="relative flex-1 group">
                    <Clock size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted group-focus-within:text-yellow-500" />
                    <input
                      type="time"
                      className="w-full h-12 pl-10 pr-3 bg-slate-50 border-none rounded-xl text-[10px] font-bold text-slate-900 focus:ring-2 focus:ring-yellow-500/20"
                      onChange={(e) => setFormData({ ...formData, scheduled_time: e.target.value })}
                    />
                  </div>
                </div>
              )}

            </div>
          </div>

          <div className="flex gap-4 pt-6">
            <Button variant="ghost" className="flex-1 h-20 rounded-[2rem] font-black uppercase tracking-widest text-xs hover:bg-red-50 hover:text-red-500 border-none" onClick={closeModal}>
              Abort
            </Button>
            <Button
              variant="accent"
              className="flex-[2] h-20 rounded-[2rem] font-black uppercase tracking-widest text-xs shadow-2xl shadow-yellow-500/20 bg-yellow-500 hover:bg-yellow-400 text-slate-900"
              onClick={() => mutation.mutate(formData)}
              disabled={(!formData.open_bidding && !formData.delivery_point_name) || (formData.open_bidding && !formData.selectedVehicleId) || mutation.isPending}
            >
              {mutation.isPending ? (
                <div className="flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" /> Transmitting...
                </div>
              ) : "Confirm Shipment Deployment"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

