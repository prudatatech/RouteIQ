import React, { useState, useEffect } from 'react';
import { XCircle, Truck, MapPin, Zap } from 'lucide-react';
import { supabase } from '@/services/supabase';
import toast from 'react-hot-toast';
import * as turf from '@turf/turf';

interface Props {
  request: any;
  onClose: () => void;
  onAssigned: () => void;
}

export default function CargoManifestConnectingForm({ request, onClose, onAssigned }: Props) {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<string>('');
  const [cost, setCost] = useState('');
  const [costPerKm, setCostPerKm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // Fetch available vehicles that meet capacity and are within 50km
    const fetchVehicles = async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .in('status', ['available', 'idle', 'offline', 'on_route'])
        .gte('available_capacity_kg', request.required_capacity_kg);
      
      if (!error && data) {
        const reqLat = request.pickup_lat;
        const reqLng = request.pickup_lng;
        
        if (reqLat && reqLng) {
          const rPoint = turf.point([reqLng, reqLat]);
          const eligible = data.filter(v => {
            if (!v.latitude || !v.longitude) return false;
            const vPoint = turf.point([v.longitude, v.latitude]);
            return turf.distance(vPoint, rPoint, { units: 'kilometers' }) <= 50;
          });
          setVehicles(eligible);
        } else {
          setVehicles(data); // Fallback if request has no coords
        }
      }
    };
    fetchVehicles();
  }, [request]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicle) {
      toast.error('Please select a vehicle');
      return;
    }
    
    setIsSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const res = await fetch(`/api/v1/vendor/shipment-request/${request.id}/assign-vehicle`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionData.session?.access_token}`
        },
        body: JSON.stringify({
          vehicle_id: selectedVehicle,
          cost: cost ? Number(cost) : undefined,
          cost_per_km: costPerKm ? Number(costPerKm) : undefined
        })
      });
      
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || await res.text());
      }
      
      toast.success('Vehicle Assigned and Cargo Manifest Created!');
      onAssigned();
    } catch (err: any) {
      toast.error('Failed to assign vehicle: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative bg-surface border border-border rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl transform transition-all animate-fade-in">
        <div className="px-6 py-5 border-b border-border flex items-center justify-between bg-surface2">
          <h2 className="font-display font-black text-xl text-text uppercase tracking-tight flex items-center gap-2">
            <Truck className="text-primary" size={20} /> Assign Vehicle
          </h2>
          <button onClick={onClose} className="text-muted hover:text-text transition-colors"><XCircle size={24} /></button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
            <h3 className="font-bold text-sm text-primary mb-2 flex items-center gap-2"><MapPin size={14}/> Request Summary</h3>
            <div className="grid grid-cols-2 gap-4 text-sm mt-3">
              <div>
                <div className="text-xs text-muted uppercase tracking-widest font-bold">Pickup</div>
                <div className="text-text font-medium truncate" title={request.pickup_location}>{request.pickup_location}</div>
              </div>
              <div>
                <div className="text-xs text-muted uppercase tracking-widest font-bold">Drop</div>
                <div className="text-text font-medium truncate" title={request.drop_location}>{request.drop_location}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-muted uppercase tracking-widest font-bold">Capacity Required</div>
                <div className="text-text font-mono font-bold text-lg">{request.required_capacity_kg} KG</div>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2">Select Vehicle</label>
            {vehicles.length === 0 ? (
              <div className="p-4 bg-error/10 border border-error/20 rounded-xl text-sm text-error font-medium">
                No available vehicles found with {request.required_capacity_kg} KG capacity within 50km.
              </div>
            ) : (
              <select 
                required
                value={selectedVehicle}
                onChange={e => setSelectedVehicle(e.target.value)}
                className="w-full bg-surface2 border border-border focus:border-primary rounded-xl px-4 py-3 text-text font-mono focus:outline-none focus:ring-1 focus:ring-primary transition-all"
              >
                <option value="">-- Select a Vehicle --</option>
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.plate_number} ({v.vehicle_type}) - {v.available_capacity_kg} KG avail.
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2">Flat Cost (₹)</label>
              <input 
                type="number"
                value={cost}
                onChange={e => setCost(e.target.value)}
                placeholder="Optional"
                className="w-full bg-surface2 border border-border focus:border-primary rounded-xl px-4 py-3 text-text font-mono focus:outline-none focus:ring-1 focus:ring-primary transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2">Cost per KM (₹)</label>
              <input 
                type="number"
                value={costPerKm}
                onChange={e => setCostPerKm(e.target.value)}
                placeholder="Optional"
                className="w-full bg-surface2 border border-border focus:border-primary rounded-xl px-4 py-3 text-text font-mono focus:outline-none focus:ring-1 focus:ring-primary transition-all"
              />
            </div>
          </div>
          
          <div className="pt-4 flex justify-end gap-3 border-t border-border">
            <button type="button" onClick={onClose} className="px-5 py-3 rounded-xl font-bold text-muted hover:text-text hover:bg-surface2 transition-colors border border-transparent hover:border-border">Cancel</button>
            <button type="submit" disabled={isSubmitting || !selectedVehicle} className="bg-primary hover:bg-primary-dark disabled:opacity-50 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-primary/20 transition-all active:scale-95 flex items-center gap-2">
              <Zap size={18} /> Confirm Assignment
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
