import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Map, { Source, Layer, Marker, NavigationControl } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';
import { MapPin, ArrowLeft, Send, Search, Info } from 'lucide-react';
import * as turf from '@turf/turf';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const DEFAULT_CENTER = { longitude: 72.8464, latitude: 19.1197 }; // Mumbai

export default function VendorShipmentRequestPage() {
  const navigate = useNavigate();
  const token = useAuthStore(s => s.token);
  
  // State
  const [viewState, setViewState] = useState({
    ...DEFAULT_CENTER,
    zoom: 10
  });
  
  // Form State
  const [capacity, setCapacity] = useState('');
  const [currentRate, setCurrentRate] = useState(45); // Default to 45, fetch if possible
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [vendorProfile, setVendorProfile] = useState<any>(null);
  
  // Pickup State
  const [pickupSearch, setPickupSearch] = useState('');
  const [pickupSuggestions, setPickupSuggestions] = useState<any[]>([]);
  const [pickupLocation, setPickupLocation] = useState<any>(null);
  
  // Drop State
  const [dropSearch, setDropSearch] = useState('');
  const [dropSuggestions, setDropSuggestions] = useState<any[]>([]);
  const [dropLocation, setDropLocation] = useState<any>(null);
  
  // Fetch market rates & profile
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [rateRes, profileRes] = await Promise.all([
          fetch('/api/v1/vendor/rates', { headers: { 'Authorization': `Bearer ${token}` } }),
          fetch('/api/v1/vendor/profile', { headers: { 'Authorization': `Bearer ${token}` } })
        ]);
        
        if (rateRes.ok) {
          const data = await rateRes.json();
          if (data && data.baseRatePerKm) setCurrentRate(data.baseRatePerKm);
        }
        
        if (profileRes.ok) {
          const profileData = await profileRes.json();
          setVendorProfile(profileData);
        }
      } catch (e) {
        console.warn('Failed to fetch data', e);
      }
    };
    if (token) fetchData();
  }, [token]);

  // Geocoding Search
  const searchMapbox = async (query: string, setSuggestions: any) => {
    if (!query || query.length < 3) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?country=in&types=place,locality,address&limit=5&access_token=${MAPBOX_TOKEN}`);
      const data = await res.json();
      setSuggestions(data.features || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => searchMapbox(pickupSearch, setPickupSuggestions), 500);
    return () => clearTimeout(timer);
  }, [pickupSearch]);

  useEffect(() => {
    const timer = setTimeout(() => searchMapbox(dropSearch, setDropSuggestions), 500);
    return () => clearTimeout(timer);
  }, [dropSearch]);

  const updateMapBounds = (newPickup: any, newDrop: any) => {
    if (newPickup && newDrop) {
      const centerLng = (newPickup.lng + newDrop.lng) / 2;
      const centerLat = (newPickup.lat + newDrop.lat) / 2;
      const distance = turf.distance(
        turf.point([newPickup.lng, newPickup.lat]),
        turf.point([newDrop.lng, newDrop.lat]),
        { units: 'kilometers' }
      );
      // Logarithmic zoom calculation based on distance
      const calculatedZoom = Math.max(4, Math.min(14, 13.5 - Math.log2(Math.max(1, distance))));
      setViewState({ longitude: centerLng, latitude: centerLat, zoom: calculatedZoom });
    } else if (newPickup) {
      setViewState({ longitude: newPickup.lng, latitude: newPickup.lat, zoom: 16 });
    } else if (newDrop) {
      setViewState({ longitude: newDrop.lng, latitude: newDrop.lat, zoom: 16 });
    }
  };

  const handleSelectPickup = (feature: any) => {
    const newLoc = {
      address: feature.place_name,
      lng: feature.center[0],
      lat: feature.center[1]
    };
    setPickupLocation(newLoc);
    setPickupSearch(feature.place_name);
    setPickupSuggestions([]);
    updateMapBounds(newLoc, dropLocation);
  };

  const handleSelectDrop = (feature: any) => {
    const newLoc = {
      address: feature.place_name,
      lng: feature.center[0],
      lat: feature.center[1]
    };
    setDropLocation(newLoc);
    setDropSearch(feature.place_name);
    setDropSuggestions([]);
    updateMapBounds(pickupLocation, newLoc);
  };

  const handleMarkerDrag = async (evt: any, type: 'pickup' | 'drop') => {
    const lng = evt.lngLat.lng;
    const lat = evt.lngLat.lat;
    
    try {
      const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}`);
      const data = await res.json();
      const placeName = data.features?.[0]?.place_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      
      if (type === 'pickup') {
        setPickupLocation({ address: placeName, lng, lat });
        setPickupSearch(placeName);
      } else {
        setDropLocation({ address: placeName, lng, lat });
        setDropSearch(placeName);
      }
    } catch (e) {
      console.error(e);
      // Fallback if API fails
      if (type === 'pickup') setPickupLocation((prev: any) => prev ? { ...prev, lng, lat } : null);
      else setDropLocation((prev: any) => prev ? { ...prev, lng, lat } : null);
    }
  };

  const handleUseWarehouse = () => {
    if (vendorProfile?.latitude && vendorProfile?.longitude) {
      const address = vendorProfile.address || `${vendorProfile.company_name} Warehouse`;
      const lng = vendorProfile.longitude;
      const lat = vendorProfile.latitude;
      const newLoc = { address, lng, lat };
      
      setPickupLocation(newLoc);
      setPickupSearch(address);
      updateMapBounds(newLoc, dropLocation);
      toast.success('Warehouse location selected');
    } else {
      toast.error('Warehouse location not found in profile');
    }
  };

  const handleUseCurrentLocation = () => {
    if (navigator.geolocation) {
      toast.loading('Getting location...', { id: 'geo' });
      navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${MAPBOX_TOKEN}`);
          const data = await res.json();
          const placeName = data.features?.[0]?.place_name || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
          const newLoc = { address: placeName, lng: longitude, lat: latitude };
          setPickupLocation(newLoc);
          setPickupSearch(placeName);
          updateMapBounds(newLoc, dropLocation);
          toast.success('Location found', { id: 'geo' });
        } catch (e) {
          console.error(e);
          const newLoc = { address: 'Current Location', lng: longitude, lat: latitude };
          setPickupLocation(newLoc);
          setPickupSearch('Current Location');
          updateMapBounds(newLoc, dropLocation);
          toast.success('Location found (coordinates)', { id: 'geo' });
        }
      }, (error) => {
        toast.error('Could not get your location.', { id: 'geo' });
      });
    } else {
      toast.error('Geolocation is not supported by your browser.');
    }
  };

  // Generate GeoJSON Circles for 5km geofencing
  const createGeoFence = (center: any) => {
    if (!center) return null;
    const centerPoint = turf.point([center.lng, center.lat]);
    const options = { steps: 64, units: 'kilometers' as turf.Units };
    return turf.circle(centerPoint, 5, options);
  };

  const pickupFence = createGeoFence(pickupLocation);
  const dropFence = createGeoFence(dropLocation);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pickupLocation || !dropLocation || !capacity) {
      toast.error('Please complete all fields');
      return;
    }
    
    setIsSubmitting(true);
    try {
      const payload = {
        pickup: pickupLocation,
        drop: dropLocation,
        capacity: Number(capacity)
      };

      const res = await fetch('/api/v1/vendor/shipment-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || await res.text());
      }
      
      toast.success('Request Sent!');
      navigate('/vendor');
    } catch (err: any) {
      toast.error('Failed to submit request: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-surface sticky top-0 z-10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/vendor')} className="text-muted hover:text-text transition-colors">
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-2xl font-display font-black uppercase tracking-tight text-text">New Shipment Request</h1>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row h-[calc(100vh-73px)]">
        {/* Left Side: Form */}
        <div className="w-full lg:w-[450px] bg-surface2 border-r border-border p-6 overflow-y-auto custom-scrollbar flex flex-col gap-6 relative z-10">
          <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 flex items-start gap-3">
            <Info className="text-primary mt-0.5" size={18} />
            <div>
              <h3 className="font-bold text-sm text-primary mb-1">Current Market Rate</h3>
              <p className="text-2xl font-display font-black tracking-tight">₹{currentRate} <span className="text-sm font-normal text-muted">/ km</span></p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6 flex-1 flex flex-col">
            
            {/* Pickup */}
            <div className="space-y-2 relative z-20">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-muted uppercase tracking-widest flex items-center gap-2">
                  <MapPin size={14} className="text-success" /> Pickup Location
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={handleUseWarehouse} className="text-[10px] bg-indigo-500/10 text-indigo-500 font-bold px-2 py-1 rounded hover:bg-indigo-500/20 transition-colors">Warehouse</button>
                  <button type="button" onClick={handleUseCurrentLocation} className="text-[10px] bg-primary/10 text-primary font-bold px-2 py-1 rounded hover:bg-primary/20 transition-colors">Your Location</button>
                  <button type="button" onClick={() => document.getElementById('pickup-search')?.focus()} className="text-[10px] bg-surface2 text-text font-bold px-2 py-1 rounded border border-border hover:bg-surface transition-colors">Other</button>
                </div>
              </div>
              <div className="relative">
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
                <input 
                  id="pickup-search"
                  type="text"
                  value={pickupSearch}
                  onChange={e => setPickupSearch(e.target.value)}
                  onFocus={() => {
                    if (pickupLocation) {
                      setViewState({ longitude: pickupLocation.lng, latitude: pickupLocation.lat, zoom: 16 });
                    }
                  }}
                  placeholder="Search pickup address..."
                  className="w-full bg-surface border border-border focus:border-primary rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none transition-all"
                />
              </div>
              {pickupSuggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-surface border border-border rounded-xl shadow-2xl max-h-48 overflow-y-auto">
                  {pickupSuggestions.map(f => (
                    <button key={f.id} type="button" onClick={() => handleSelectPickup(f)} className="w-full text-left px-4 py-3 hover:bg-surface2 border-b border-border/50 last:border-0">
                      <div className="font-bold text-sm text-text">{f.text}</div>
                      <div className="text-[10px] text-muted truncate">{f.place_name}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Drop */}
            <div className="space-y-2 relative z-10">
              <label className="block text-xs font-bold text-muted uppercase tracking-widest flex items-center gap-2">
                <MapPin size={14} className="text-error" /> Drop Location
              </label>
              <div className="relative">
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
                <input 
                  type="text"
                  value={dropSearch}
                  onChange={e => setDropSearch(e.target.value)}
                  onFocus={() => {
                    if (dropLocation) {
                      setViewState({ longitude: dropLocation.lng, latitude: dropLocation.lat, zoom: 16 });
                    }
                  }}
                  placeholder="Search drop address..."
                  className="w-full bg-surface border border-border focus:border-primary rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none transition-all"
                />
              </div>
              {dropSuggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-surface border border-border rounded-xl shadow-2xl max-h-48 overflow-y-auto">
                  {dropSuggestions.map(f => (
                    <button key={f.id} type="button" onClick={() => handleSelectDrop(f)} className="w-full text-left px-4 py-3 hover:bg-surface2 border-b border-border/50 last:border-0">
                      <div className="font-bold text-sm text-text">{f.text}</div>
                      <div className="text-[10px] text-muted truncate">{f.place_name}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Capacity */}
            <div className="space-y-2 relative z-0">
              <label className="block text-xs font-bold text-muted uppercase tracking-widest">
                Required Capacity (KG)
              </label>
              <input 
                type="number"
                required
                value={capacity}
                onChange={e => setCapacity(e.target.value)}
                placeholder="e.g. 5000"
                className="w-full bg-surface border border-border focus:border-primary rounded-xl px-4 py-3 font-mono text-text focus:outline-none transition-all"
              />
            </div>

            <div className="mt-auto pt-6 border-t border-border">
              <button 
                type="submit" 
                disabled={isSubmitting || !pickupLocation || !dropLocation || !capacity}
                className="w-full bg-primary hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 rounded-xl font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-primary/20"
              >
                {isSubmitting ? 'Submitting...' : 'Submit Request'} <Send size={18} />
              </button>
            </div>

          </form>
        </div>

        {/* Right Side: Map */}
        <div className="flex-1 relative bg-surface z-0">
          <Map
            {...viewState}
            // @ts-ignore
            onMove={(evt: any) => setViewState(evt.viewState)}
            mapStyle="mapbox://styles/mapbox/streets-v12"
            mapboxAccessToken={MAPBOX_TOKEN}
          >
            <NavigationControl position="bottom-right" />
            
            {/* Pickup Marker and Geofence */}
            {pickupLocation && (
              <>
                <Marker 
                  longitude={pickupLocation.lng} 
                  latitude={pickupLocation.lat}
                  draggable
                  onDragEnd={(e) => handleMarkerDrag(e, 'pickup')}
                >
                  <div className="text-success animate-bounce cursor-grab active:cursor-grabbing"><MapPin size={32} /></div>
                </Marker>
                {pickupFence && (
                  <Source id="pickup-geo" type="geojson" data={pickupFence}>
                    <Layer
                      id="pickup-geo-layer"
                      type="fill"
                      paint={{
                        'fill-color': '#10B981', // success color
                        'fill-opacity': 0.1
                      }}
                    />
                    <Layer
                      id="pickup-geo-outline"
                      type="line"
                      paint={{
                        'line-color': '#10B981',
                        'line-width': 2,
                        'line-dasharray': [2, 2]
                      }}
                    />
                  </Source>
                )}
              </>
            )}

            {/* Drop Marker and Geofence */}
            {dropLocation && (
              <>
                <Marker 
                  longitude={dropLocation.lng} 
                  latitude={dropLocation.lat}
                  draggable
                  onDragEnd={(e) => handleMarkerDrag(e, 'drop')}
                >
                  <div className="text-error animate-bounce cursor-grab active:cursor-grabbing"><MapPin size={32} /></div>
                </Marker>
                {dropFence && (
                  <Source id="drop-geo" type="geojson" data={dropFence}>
                    <Layer
                      id="drop-geo-layer"
                      type="fill"
                      paint={{
                        'fill-color': '#EF4444', // error color
                        'fill-opacity': 0.1
                      }}
                    />
                    <Layer
                      id="drop-geo-outline"
                      type="line"
                      paint={{
                        'line-color': '#EF4444',
                        'line-width': 2,
                        'line-dasharray': [2, 2]
                      }}
                    />
                  </Source>
                )}
              </>
            )}
          </Map>
          
          <div className="absolute top-6 right-6 bg-surface2/90 backdrop-blur border border-border rounded-xl p-4 shadow-xl">
            <h4 className="font-bold text-sm mb-2 flex items-center gap-2 text-text"><MapPin size={14} className="text-primary"/> Geofencing Active</h4>
            <p className="text-xs text-muted max-w-xs">The 5km operating radius (dashed lines) represents the pickup and delivery catchment zones for matching nearby vehicles.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
