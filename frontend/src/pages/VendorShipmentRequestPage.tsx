import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Map, { Source, Layer, Marker, NavigationControl } from 'react-map-gl/maplibre';
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';
import { MapPin, ArrowLeft, Send, Search, Info, Package, User, FileText, Settings, ShieldAlert, Sparkles, Zap } from 'lucide-react';
import * as turf from '@turf/turf';
import { searchHSN, type HSNEntry } from '@/utils/hsnDatabase';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const DEFAULT_CENTER = { longitude: 72.8464, latitude: 19.1197 }; // Mumbai

const PRODUCT_CATEGORIES = [
  "FMCG", "Electronics", "Textile", "Steel", "Cement", 
  "Agriculture", "Chemicals", "Furniture", "Automobile Parts", "Machinery"
];

const PACKAGING_TYPES = [
  "Box", "Carton", "Bag", "Drum", "Pallet", "Roll", "Loose", "Bundle", "Container"
];

const UNITS = [
  "Kg", "Ton", "Piece", "Box", "Bag", "Drum", "Litre", "Roll", "Carton"
];

export default function VendorShipmentRequestPage() {
  const navigate = useNavigate();
  const location = useLocation();
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
  
  // New Detailed Form State
  const [consigneeName, setConsigneeName] = useState('');
  const [consigneeContact, setConsigneeContact] = useState('');
  const [consigneeEmail, setConsigneeEmail] = useState('');
  
  const [productCategory, setProductCategory] = useState('');
  const [productName, setProductName] = useState('');
  const [brand, setBrand] = useState('');
  const [modelVariant, setModelVariant] = useState('');
  
  const [packagingType, setPackagingType] = useState('');
  const [noOfPackages, setNoOfPackages] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [declaredValue, setDeclaredValue] = useState('');
  
  // HSN Code State
  const [hsnCode, setHsnCode] = useState('');
  const [hsnDescription, setHsnDescription] = useState('');
  const [gstRate, setGstRate] = useState('');
  const [hsnSuggestions, setHsnSuggestions] = useState<HSNEntry[]>([]);
  const [showHsnDropdown, setShowHsnDropdown] = useState(false);
  const hsnDropdownRef = useRef<HTMLDivElement>(null);
  
  const [specialHandling, setSpecialHandling] = useState({
    fragile: false,
    hazardous: false,
    coldChain: false,
    stackable: false,
    highValue: false
  });
  const [remarks, setRemarks] = useState('');
  
  // Pickup State
  const [pickupSearch, setPickupSearch] = useState('');
  const [pickupSuggestions, setPickupSuggestions] = useState<any[]>([]);
  const [pickupLocation, setPickupLocation] = useState<any>(null);
  
  // Drop State
  const [dropSearch, setDropSearch] = useState('');
  const [dropSuggestions, setDropSuggestions] = useState<any[]>([]);
  const [dropLocation, setDropLocation] = useState<any>(null);
  
  // Fetch market rates & profile & handle initial state
  useEffect(() => {
    // 1. Restore from session if pending (Deferred Auth)
    let restored = false;
    if (token) {
      const pendingMapRequest = sessionStorage.getItem('pendingMapRequest');
      if (pendingMapRequest) {
        const data = JSON.parse(pendingMapRequest);
        setPickupLocation(data.pickup);
        setPickupSearch(data.pickup?.address || '');
        setDropLocation(data.drop);
        setDropSearch(data.drop?.address || '');
        setCapacity(data.capacity?.toString() || '');
        sessionStorage.removeItem('pendingMapRequest');
        restored = true;
      }
    } 
    
    if (!restored) {
      // 2. Parse URL query params (from Hero Search)
      const params = new URLSearchParams(location.search);
      const query = params.get('query');
      const lat = params.get('lat');
      const lng = params.get('lng');
      
      if (query && !pickupLocation) {
        setPickupSearch(query);
        if (lat && lng) {
          const newLoc = { address: query, lat: parseFloat(lat), lng: parseFloat(lng) };
          setPickupLocation(newLoc);
          setViewState({ longitude: newLoc.lng, latitude: newLoc.lat, zoom: 14 });
        }
      }
    }

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
  }, [token, location.search]);

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
    if (pickupLocation && pickupSearch === pickupLocation.address) {
      setPickupSuggestions([]);
      return;
    }
    const timer = setTimeout(() => searchMapbox(pickupSearch, setPickupSuggestions), 500);
    return () => clearTimeout(timer);
  }, [pickupSearch, pickupLocation]);

  useEffect(() => {
    if (dropLocation && dropSearch === dropLocation.address) {
      setDropSuggestions([]);
      return;
    }
    const timer = setTimeout(() => searchMapbox(dropSearch, setDropSuggestions), 500);
    return () => clearTimeout(timer);
  }, [dropSearch, dropLocation]);

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

  // HSN Auto-suggest: triggers on product name or HSN input changes
  useEffect(() => {
    const query = hsnCode || productName;
    if (query && query.length >= 2) {
      const results = searchHSN(query, productCategory);
      setHsnSuggestions(results);
      if (results.length > 0 && !hsnCode) setShowHsnDropdown(true);
    } else {
      setHsnSuggestions([]);
    }
  }, [hsnCode, productName, productCategory]);

  // Close HSN dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (hsnDropdownRef.current && !hsnDropdownRef.current.contains(e.target as Node)) {
        setShowHsnDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectHSN = (entry: HSNEntry) => {
    setHsnCode(entry.hsn);
    setHsnDescription(entry.description);
    setGstRate(String(entry.gstRate));
    setShowHsnDropdown(false);
    toast.success(`HSN ${entry.hsn} selected — ${entry.gstRate}% GST`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pickupLocation || !dropLocation || !capacity || !productCategory || !productName) {
      toast.error('Please complete all required fields');
      return;
    }
    
    
    const payload = {
      pickup: pickupLocation,
      drop: dropLocation,
      capacity: Number(capacity),
      metadata: {
        consignee: {
          name: consigneeName,
          contact: consigneeContact,
          email: consigneeEmail,
        },
        cargo: {
          category: productCategory,
          name: productName,
          brand,
          modelVariant,
          hsnCode,
          hsnDescription,
          gstRate: gstRate ? Number(gstRate) : null,
          packagingType,
          noOfPackages: Number(noOfPackages) || 0,
          quantity: Number(quantity) || 0,
          unit,
          grossWeightKg: Number(capacity),
          declaredValue,
          specialHandling,
          remarks
        }
      }
    };

    if (!token) {
      sessionStorage.setItem('pendingMapRequest', JSON.stringify(payload));
      toast('Please log in or create an account to post this load.', { icon: '🔒' });
      navigate('/vendor/login');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/v1/vendor/shipment-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        const errorText = await res.text();
        let errorMessage = errorText;
        try {
          const errData = JSON.parse(errorText);
          if (errData.error || errData.detail) errorMessage = errData.error || errData.detail;
        } catch (e) {}
        throw new Error(errorMessage);
      }
      
      toast.success('Shipment Request Created!');
      navigate('/vendor/shipments');
    } catch (err: any) {
      toast.error('Failed to submit request: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const InputSectionHeader = ({ title, icon: Icon }: { title: string, icon: any }) => (
    <div className="flex items-center gap-2 mb-4 mt-8 first:mt-0 pb-2 border-b border-border">
      <Icon size={18} className="text-primary" />
      <h3 className="font-display font-bold text-text uppercase tracking-wider text-sm">{title}</h3>
    </div>
  );

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-surface sticky top-0 z-30 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="text-muted hover:text-text transition-colors">
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-2xl font-display font-black uppercase tracking-tight text-text">New Shipment Request</h1>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row h-[calc(100vh-73px)]">
        {/* Left Side: Form */}
        <div className="w-full lg:w-[500px] bg-surface2 border-r border-border p-6 overflow-y-auto custom-scrollbar flex flex-col gap-6 relative z-10 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-6 flex-1 flex flex-col">
            
            <InputSectionHeader title="Routing Details" icon={MapPin} />
            
            {/* Pickup */}
            <div className="space-y-2 relative z-20">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-muted uppercase tracking-widest flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-success"></span> Pickup Location <span className="text-error">*</span>
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={handleUseWarehouse} className="text-[10px] bg-indigo-500/10 text-indigo-500 font-bold px-2 py-1 rounded hover:bg-indigo-500/20 transition-colors">Warehouse</button>
                  <button type="button" onClick={handleUseCurrentLocation} className="text-[10px] bg-primary/10 text-primary font-bold px-2 py-1 rounded hover:bg-primary/20 transition-colors">Your Location</button>
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
                <span className="w-2 h-2 rounded-full bg-error"></span> Drop Location <span className="text-error">*</span>
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

            <InputSectionHeader title="Consignee Details (Receiver)" icon={User} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-muted uppercase tracking-widest">Name</label>
                <input type="text" value={consigneeName} onChange={e => setConsigneeName(e.target.value)} placeholder="E.g. Rahul Sharma" className="w-full bg-surface border border-border focus:border-primary rounded-xl px-4 py-3 text-sm focus:outline-none transition-all" />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-bold text-muted uppercase tracking-widest">Contact Number</label>
                <input type="text" value={consigneeContact} onChange={e => setConsigneeContact(e.target.value)} placeholder="+91 9876543210" className="w-full bg-surface border border-border focus:border-primary rounded-xl px-4 py-3 text-sm focus:outline-none transition-all" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="block text-xs font-bold text-muted uppercase tracking-widest">Email Address</label>
                <input type="email" value={consigneeEmail} onChange={e => setConsigneeEmail(e.target.value)} placeholder="rahul@example.com" className="w-full bg-surface border border-border focus:border-primary rounded-xl px-4 py-3 text-sm focus:outline-none transition-all" />
              </div>
            </div>

            <InputSectionHeader title="Product Details" icon={Package} />
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-muted uppercase tracking-widest">Product Category <span className="text-error">*</span></label>
                <select required value={productCategory} onChange={e => setProductCategory(e.target.value)} className="w-full bg-surface border border-border focus:border-primary rounded-xl px-4 py-3 text-sm focus:outline-none transition-all cursor-pointer">
                  <option value="" disabled>Select Category</option>
                  {PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              
              <div className="space-y-2">
                <label className="block text-xs font-bold text-muted uppercase tracking-widest">Product Name <span className="text-error">*</span></label>
                <input required type="text" value={productName} onChange={e => setProductName(e.target.value)} placeholder="E.g. Basmati Rice" className="w-full bg-surface border border-border focus:border-primary rounded-xl px-4 py-3 text-sm focus:outline-none transition-all" />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-muted uppercase tracking-widest">Brand</label>
                <input type="text" value={brand} onChange={e => setBrand(e.target.value)} placeholder="E.g. India Gate" className="w-full bg-surface border border-border focus:border-primary rounded-xl px-4 py-3 text-sm focus:outline-none transition-all" />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-muted uppercase tracking-widest">Model / Variant</label>
                <input type="text" value={modelVariant} onChange={e => setModelVariant(e.target.value)} placeholder="E.g. 1121 Steam" className="w-full bg-surface border border-border focus:border-primary rounded-xl px-4 py-3 text-sm focus:outline-none transition-all" />
              </div>
            </div>

            {/* HSN Auto-Suggest Section */}
            <div className="mt-6 p-4 bg-gradient-to-br from-primary/5 to-accent/5 border border-primary/20 rounded-2xl">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles size={18} className="text-primary" />
                <h4 className="font-display font-bold text-text uppercase tracking-wider text-xs">Smart HSN Classification</h4>
                <span className="text-[9px] bg-primary/20 text-primary px-2 py-0.5 rounded-full font-bold uppercase tracking-widest">Auto-Suggest</span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* HSN Code Input */}
                <div className="space-y-2 relative" ref={hsnDropdownRef}>
                  <label className="block text-xs font-bold text-muted uppercase tracking-widest">HSN Code <span className="text-error">*</span></label>
                  <div className="relative">
                    <input 
                      type="text" 
                      value={hsnCode} 
                      onChange={e => { setHsnCode(e.target.value); setShowHsnDropdown(true); }}
                      onFocus={() => { if (hsnSuggestions.length > 0) setShowHsnDropdown(true); }}
                      placeholder="E.g. 1006 or type product" 
                      className="w-full bg-surface border border-border focus:border-primary rounded-xl px-4 py-3 text-sm font-mono font-bold focus:outline-none transition-all pr-10" 
                    />
                    {hsnSuggestions.length > 0 && (
                      <Zap size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-primary animate-pulse" />
                    )}
                  </div>
                  
                  {/* Auto-suggest Dropdown */}
                  {showHsnDropdown && hsnSuggestions.length > 0 && (
                    <div className="absolute z-50 w-[320px] mt-1 bg-surface border border-border rounded-xl shadow-2xl max-h-64 overflow-y-auto">
                      <div className="px-3 py-2 bg-surface2 border-b border-border">
                        <p className="text-[9px] font-bold text-muted uppercase tracking-widest">🟡 Suggestions based on {hsnCode ? 'HSN/Product' : 'Product Name'}</p>
                      </div>
                      {hsnSuggestions.map((entry, i) => (
                        <button 
                          key={`${entry.hsn}-${i}`} 
                          type="button" 
                          onClick={() => handleSelectHSN(entry)}
                          className="w-full text-left px-4 py-3 hover:bg-primary/10 border-b border-border/30 last:border-0 transition-colors group"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-black text-sm text-primary">{entry.hsn}</span>
                            <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">{entry.gstRate}% GST</span>
                          </div>
                          <div className="text-xs font-bold text-text mt-1 group-hover:text-primary transition-colors">{entry.description}</div>
                          <div className="text-[10px] text-muted mt-0.5">{entry.category}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                
                {/* Product Description */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-muted uppercase tracking-widest">Description <span className="text-[9px] text-primary">🟡 Auto-suggest</span></label>
                  <input 
                    type="text" 
                    value={hsnDescription} 
                    onChange={e => setHsnDescription(e.target.value)} 
                    placeholder="Based on Product Name" 
                    className="w-full bg-surface border border-border focus:border-primary rounded-xl px-4 py-3 text-sm focus:outline-none transition-all" 
                  />
                </div>
                
                {/* GST Rate */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-muted uppercase tracking-widest">GST Rate (%) <span className="text-[9px] text-primary">🟡 Auto-suggest</span></label>
                  <input 
                    type="text" 
                    value={gstRate ? `${gstRate}%` : ''} 
                    onChange={e => setGstRate(e.target.value.replace('%', ''))} 
                    placeholder="Based on HSN/Product" 
                    className="w-full bg-surface border border-border focus:border-primary rounded-xl px-4 py-3 text-sm font-bold text-emerald-400 focus:outline-none transition-all" 
                  />
                </div>
              </div>
              
              {/* Smart tip */}
              {!hsnCode && productName && hsnSuggestions.length > 0 && (
                <div className="mt-3 flex items-center gap-2 text-[10px] text-primary font-bold uppercase tracking-widest animate-pulse">
                  <Sparkles size={12} />
                  <span>We found {hsnSuggestions.length} HSN codes matching "{productName}" — click above to auto-fill</span>
                </div>
              )}
            </div>

            <InputSectionHeader title="Packaging & Quantity" icon={Settings} />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-muted uppercase tracking-widest">Packaging</label>
                <select value={packagingType} onChange={e => setPackagingType(e.target.value)} className="w-full bg-surface border border-border focus:border-primary rounded-xl px-4 py-3 text-sm focus:outline-none transition-all cursor-pointer">
                  <option value="" disabled>Select Type</option>
                  {PACKAGING_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              
              <div className="space-y-2">
                <label className="block text-xs font-bold text-muted uppercase tracking-widest">No. Packages</label>
                <input type="number" value={noOfPackages} onChange={e => setNoOfPackages(e.target.value)} placeholder="E.g. 250" className="w-full bg-surface border border-border focus:border-primary rounded-xl px-4 py-3 text-sm focus:outline-none transition-all" />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-muted uppercase tracking-widest">Quantity</label>
                <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="E.g. 250" className="w-full bg-surface border border-border focus:border-primary rounded-xl px-4 py-3 text-sm focus:outline-none transition-all" />
              </div>
              
              <div className="space-y-2">
                <label className="block text-xs font-bold text-muted uppercase tracking-widest">Unit</label>
                <select value={unit} onChange={e => setUnit(e.target.value)} className="w-full bg-surface border border-border focus:border-primary rounded-xl px-4 py-3 text-sm focus:outline-none transition-all cursor-pointer">
                  <option value="" disabled>Select Unit</option>
                  {UNITS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-muted uppercase tracking-widest">Gross Wt (KG) <span className="text-error">*</span></label>
                <input required type="number" value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="E.g. 5000" className="w-full bg-surface border border-border focus:border-primary rounded-xl px-4 py-3 text-sm font-bold text-primary focus:outline-none transition-all" />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-muted uppercase tracking-widest">Declared Value</label>
                <input type="text" value={declaredValue} onChange={e => setDeclaredValue(e.target.value)} placeholder="₹5,80,000" className="w-full bg-surface border border-border focus:border-primary rounded-xl px-4 py-3 text-sm focus:outline-none transition-all" />
              </div>
            </div>

            <InputSectionHeader title="Special Handling" icon={ShieldAlert} />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { id: 'fragile', label: 'Fragile' },
                { id: 'hazardous', label: 'Hazardous' },
                { id: 'coldChain', label: 'Cold Chain' },
                { id: 'stackable', label: 'Stackable' },
                { id: 'highValue', label: 'High Value' }
              ].map(opt => (
                <label key={opt.id} className="flex items-center gap-2 cursor-pointer bg-surface border border-border p-3 rounded-xl hover:border-primary transition-all">
                  <input 
                    type="checkbox" 
                    // @ts-ignore
                    checked={specialHandling[opt.id]}
                    // @ts-ignore
                    onChange={(e) => setSpecialHandling(s => ({ ...s, [opt.id]: e.target.checked }))}
                    className="w-4 h-4 text-primary rounded focus:ring-primary focus:ring-offset-surface bg-surface border-border"
                  />
                  <span className="text-sm font-medium">{opt.label}</span>
                </label>
              ))}
            </div>

            <InputSectionHeader title="Remarks" icon={FileText} />
            <div className="space-y-2">
              <textarea 
                value={remarks} 
                onChange={e => setRemarks(e.target.value)} 
                placeholder="Handle Carefully..." 
                className="w-full bg-surface border border-border focus:border-primary rounded-xl px-4 py-3 text-sm focus:outline-none transition-all min-h-[100px] resize-y"
              />
            </div>

            <div className="pt-6 border-t border-border mt-8">
              <button 
                type="submit" 
                disabled={isSubmitting || !pickupLocation || !dropLocation || !capacity || !productCategory || !productName}
                className="w-full bg-primary hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 rounded-xl font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-primary/20"
              >
                {isSubmitting ? 'Creating Shipment...' : 'Submit Request'} <Send size={18} />
              </button>
            </div>

          </form>
        </div>

        {/* Right Side: Map */}
        <div className="flex-1 relative bg-surface z-0 hidden lg:block">
          <Map
            {...viewState}
            // @ts-ignore
            onMove={(evt: any) => setViewState(evt.viewState)}
            mapStyle="/map-style.json?v=3"
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
