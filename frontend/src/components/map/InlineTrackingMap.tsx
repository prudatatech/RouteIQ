import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Smartphone } from 'lucide-react'
import { shipmentsAPI, telemetryAPI } from '@/services/api'
import { formatEta } from '@/utils/timeFormat'
import LiveMap from './LiveMap'
import { Button } from '@/components/ui'
import toast from 'react-hot-toast'

export default function InlineTrackingMap({ trackingId, allVehicles = [] }: { trackingId: string, allVehicles?: any[] }) {
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
    <div className="h-80 w-full rounded-2xl overflow-hidden border-2 border-slate-100 bg-white shadow-inner relative group mt-4">
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
