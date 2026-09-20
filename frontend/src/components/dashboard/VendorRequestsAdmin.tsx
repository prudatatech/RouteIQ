import { useState, useEffect } from 'react'
import { supabase } from '@/services/supabase'
import toast from 'react-hot-toast'
import { ArrowRight, Truck, X, Package, AlertCircle, CheckCircle2, Trash2 } from 'lucide-react'
import * as turf from '@turf/turf'
import { useAutoAnimate } from '@formkit/auto-animate/react'

export default function VendorRequestsAdmin() {
  const [requests, setRequests] = useState<any[]>([])
  const [vehicles, setVehicles] = useState<any[]>([])
  const [selectedReq, setSelectedReq] = useState<any>(null)
  const [selectedVehicle, setSelectedVehicle] = useState('')
  const [loading, setLoading] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [listRef] = useAutoAnimate()

  useEffect(() => {
    fetchRequests()
    fetchVehicles()
    const sub = supabase.channel('admin_vendor_requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendor_shipment_requests' }, fetchRequests)
      .subscribe()
    return () => { supabase.removeChannel(sub) }
  }, [])

  const fetchRequests = async () => {
    setLoading(true)
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      const res = await fetch('/api/v1/vendor/shipment-request/pending', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) setRequests(await res.json())
    } finally { setLoading(false) }
  }

  const fetchVehicles = async () => {
    const { data } = await supabase
      .from('vehicles')
      .select('id, plate_number, vehicle_type, available_capacity_kg, status, latitude, longitude')
      .in('status', ['available', 'on_route', 'idle', 'offline'])
      .order('plate_number')
    if (data) setVehicles(data)
  }

  const getEligibleVehicles = () => {
    if (!selectedReq) return [];
    const reqLat = selectedReq.pickup_lat;
    const reqLng = selectedReq.pickup_lng;
    const reqCap = selectedReq.required_capacity_kg;
    
    return vehicles.filter(v => {
      if ((v.available_capacity_kg || 0) < reqCap) return false;
      if (!v.latitude || !v.longitude || !reqLat || !reqLng) return false;
      
      const vPoint = turf.point([v.longitude, v.latitude]);
      const rPoint = turf.point([reqLng, reqLat]);
      const dist = turf.distance(vPoint, rPoint, { units: 'kilometers' });
      return dist <= 50;
    });
  }

  const handleAssign = async () => {
    if (!selectedReq || !selectedVehicle) return
    setAssigning(true)
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      const res = await fetch(`/api/v1/vendor/shipment-request/${selectedReq.id}/assign-vehicle`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: selectedVehicle })
      })
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed') }
      toast.success('Vehicle assigned — cargo manifest created!')
      setSelectedReq(null); setSelectedVehicle(''); fetchRequests()
    } catch (err: any) { toast.error(err.message) }
    finally { setAssigning(false) }
  }

  const handleApprove = async (id: string) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token
    const res = await fetch(`/api/v1/vendor/shipment-request/${id}/approve`, {
      method: 'PUT', headers: { 'Authorization': `Bearer ${token}` }
    })
    if (res.ok) { toast.success('Request approved'); fetchRequests() }
    else toast.error('Failed to approve')
  }

  const handleReject = async (id: string) => {
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      const res = await fetch(`/api/v1/vendor/shipment-request/${id}/reject`, {
        method: 'PUT', headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      toast.success('Request rejected');
      fetchRequests();
    } catch (err: any) {
      toast.error('Failed to reject: ' + err.message);
    }
  }

  const handleRemove = async (id: string) => {
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      const res = await fetch(`/api/v1/vendor/shipment-request/${id}/reject`, {
        method: 'PUT', headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      toast.success('Permanently removed');
      fetchRequests();
    } catch (err: any) {
      toast.error('Failed to remove: ' + err.message);
    }
  }

  return (
    <>
      <div className="flex flex-col h-full">
      {/* Standardized Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Vendor requests</h2>
          {requests.length > 0 && (
            <span className="bg-indigo-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center shadow-sm">
              {requests.length}
            </span>
          )}
        </div>
      </div>

      {/* Scrollable List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div ref={listRef as any} className="divide-y divide-slate-100">
          {loading ? (
            <div className="text-center py-10 text-slate-400 text-xs font-bold">Loading...</div>
          ) : requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 py-16">
              <Package size={32} className="mb-2 text-slate-200" strokeWidth={1.5} />
              <span className="text-sm">No pending requests</span>
            </div>
          ) : requests.map(req => (
            <div key={req.id} className="p-4 hover:bg-slate-50 transition-colors">
              <div className="flex justify-between items-start mb-2.5">
                <div>
                  <div className="font-semibold text-sm text-slate-900">
                    {req.vendor_profiles?.company_name || 'Vendor'}
                  </div>
                  <div className="text-xs text-slate-600 flex items-center gap-1.5 mt-0.5">
                    <span className="truncate max-w-[100px]">{req.pickup_location?.split(',')[0]}</span>
                    <ArrowRight size={12} className="text-slate-400 flex-shrink-0" />
                    <span className="truncate max-w-[100px]">{req.drop_location?.split(',')[0]}</span>
                  </div>
                </div>
                <span className="bg-indigo-50 text-indigo-700 rounded-md px-2 py-0.5 text-xs font-semibold flex-shrink-0">
                  {req.required_capacity_kg} kg
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                {req.status === 'pending' && (
                  <>
                    <button
                      onClick={() => handleApprove(req.id)}
                      className="col-span-1 py-2 rounded-lg border border-emerald-600 bg-emerald-600 text-white text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-emerald-700 shadow-sm transition-colors"
                    >
                      <CheckCircle2 size={14} /> Approve
                    </button>
                    <button
                      onClick={() => handleReject(req.id)}
                      className="col-span-1 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-slate-50 shadow-sm transition-colors"
                    >
                      <X size={14} /> Reject
                    </button>
                  </>
                )}
                <button
                  onClick={() => { setSelectedReq(req); setSelectedVehicle('') }}
                  className="col-span-1 py-2 rounded-lg border border-yellow-500 bg-yellow-500 text-yellow-950 text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-yellow-600 shadow-sm transition-colors"
                >
                  <Truck size={14} /> Assign Vehicle
                </button>
                <button
                  onClick={async () => {
                    toast.success('Escalated to 3PL Network');
                    const { data: { session } } = await supabase.auth.getSession();
                    await fetch(`/api/v1/vendor/shipment-request/${req.id}/reject`, {
                      method: 'PUT', headers: { 'Authorization': `Bearer ${session?.access_token}` }
                    });
                    fetchRequests();
                  }}
                  className="col-span-1 py-2 rounded-lg border border-slate-800 bg-slate-800 text-white text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-slate-900 shadow-sm transition-colors"
                >
                  <AlertCircle size={14} /> Escalate to 3PL
                </button>
              </div>
              </div>
            ))}
        </div>
      </div>
    </div>

    {/* Assign Vehicle Modal */}
      {selectedReq && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)' }}
          onClick={e => { if (e.target === e.currentTarget) setSelectedReq(null) }}
        >
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-fade-in">
            {/* Modal header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-yellow-50">
              <div className="flex items-center gap-3">
                <div className="bg-yellow-400 rounded-xl p-2"><Truck size={18} color="#0F172A" /></div>
                <div>
                  <div className="font-black text-slate-800 text-base">Assign to Cargo Manifest</div>
                  <div className="text-[11px] text-yellow-700 font-semibold">Creates manifest entry automatically</div>
                </div>
              </div>
              <button onClick={() => setSelectedReq(null)} className="text-slate-400 hover:text-slate-700 transition-colors p-1">
                <X size={20} />
              </button>
            </div>

            {/* Route info */}
            <div className="px-6 py-3 bg-slate-50 border-b border-slate-100">
              <div className="text-[10px] font-black uppercase tracking-widest text-yellow-500 mb-1">
                {selectedReq.vendor_profiles?.company_name || 'Vendor'}
              </div>
              <div className="font-bold text-sm text-slate-800 flex items-center gap-2 mb-1">
                <span>{selectedReq.pickup_location?.split(',')[0]}</span>
                <ArrowRight size={13} className="text-yellow-500" />
                <span>{selectedReq.drop_location?.split(',')[0]}</span>
              </div>
              <span className="bg-slate-800 text-yellow-400 rounded-lg px-2.5 py-0.5 text-[10px] font-mono font-bold">
                {selectedReq.required_capacity_kg} KG Required
              </span>
            </div>

            {/* Vehicle list */}
            <div className="px-6 pt-5 pb-6">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
                Select Vehicle
              </div>
              {getEligibleVehicles().length === 0 ? (
                <div className="flex items-center gap-2 p-3.5 bg-orange-50 border border-orange-200 rounded-xl text-orange-700 text-xs font-semibold">
                  <AlertCircle size={15} /> No available vehicles within 50km
                </div>
              ) : (
                <div className="flex flex-col gap-2 max-h-52 overflow-y-auto pr-1">
                  {getEligibleVehicles().map(v => (
                    <button
                      key={v.id}
                      onClick={() => setSelectedVehicle(v.id)}
                      className={`flex items-center justify-between p-3.5 rounded-xl border-2 text-left transition-all ${
                        selectedVehicle === v.id
                          ? 'border-yellow-400 bg-yellow-50'
                          : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${selectedVehicle === v.id ? 'bg-yellow-400' : 'bg-slate-200'}`}>
                          <Truck size={16} color={selectedVehicle === v.id ? '#0F172A' : '#64748b'} />
                        </div>
                        <div>
                          <div className="font-black text-slate-800 text-sm">{v.plate_number}</div>
                          <div className="text-[11px] text-slate-500 font-semibold capitalize">{v.vehicle_type}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-black text-slate-800 text-sm">{v.available_capacity_kg} KG</div>
                        <div className={`text-[10px] font-bold uppercase tracking-wide ${v.status === 'available' ? 'text-green-600' : 'text-blue-600'}`}>
                          {v.status}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex gap-3 mt-5">
                <button
                  onClick={() => setSelectedReq(null)}
                  className="flex-1 py-3 rounded-xl border border-slate-200 bg-white text-slate-500 font-bold text-sm hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAssign}
                  disabled={!selectedVehicle || assigning}
                  className={`flex-[2] py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all ${
                    selectedVehicle && !assigning
                      ? 'bg-yellow-400 text-slate-900 hover:bg-yellow-300 shadow-lg shadow-yellow-200'
                      : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  {assigning ? 'Assigning...' : <><Truck size={15} /> Assign &amp; Create Manifest</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
