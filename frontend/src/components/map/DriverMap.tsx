import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import axios from 'axios';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

interface DriverMapProps {
  currentLat: number;
  currentLng: number;
  targetLat: number;
  targetLng: number;
  shiftStatus: string;
  speed?: number;
}

export default function DriverMap({ currentLat, currentLng, targetLat, targetLng, shiftStatus, speed = 0 }: DriverMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInst = useRef<mapboxgl.Map | null>(null);
  const markerInst = useRef<mapboxgl.Marker | null>(null);
  const [eta, setEta] = useState<string>('--');
  const [distance, setDistance] = useState<string>('--');

  useEffect(() => {
    if (!mapRef.current || !MAPBOX_TOKEN || MAPBOX_TOKEN === 'your_mapbox_token_here') {
      if (mapRef.current) {
         mapRef.current.innerHTML = '<div class="p-8 text-center text-muted h-full flex items-center justify-center bg-slate-900">Mapbox token missing</div>';
      }
      return;
    }

    if (!mapInst.current) {
      mapboxgl.accessToken = MAPBOX_TOKEN;
      const map = new mapboxgl.Map({
        container: mapRef.current,
        style: 'mapbox://styles/mapbox/navigation-night-v1',
        center: [currentLng, currentLat],
        zoom: 14,
        pitch: 60,
        attributionControl: false,
      });

      map.on('load', () => {
        // Add Marker
        const el = document.createElement('div');
        el.innerHTML = '<div class="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center animate-pulse"><div class="w-4 h-4 bg-primary rounded-full shadow-lg border-2 border-white"></div></div>';
        
        markerInst.current = new mapboxgl.Marker(el)
          .setLngLat([currentLng, currentLat])
          .addTo(map);

        // Add Route Source and Layer
        map.addSource('route', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
        });
        
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#4FACFE', 'line-width': 6, 'line-opacity': 0.8 }
        });
        
        // Add Destination Marker
        const destEl = document.createElement('div');
        destEl.innerHTML = '<div class="text-3xl drop-shadow-xl filter">📍</div>';
        new mapboxgl.Marker(destEl)
          .setLngLat([targetLng, targetLat])
          .addTo(map);
      });

      mapInst.current = map;
    }

    return () => {
      mapInst.current?.remove();
      mapInst.current = null;
    };
  }, []);

  // Update Route and Marker
  useEffect(() => {
    if (!mapInst.current || !MAPBOX_TOKEN || MAPBOX_TOKEN === 'your_mapbox_token_here') return;

    if (markerInst.current) {
      markerInst.current.setLngLat([currentLng, currentLat]);
    }

    if (shiftStatus === 'ON_MISSION') {
      mapInst.current.panTo([currentLng, currentLat], { duration: 1000 });
    }

    // Fetch Route
    const fetchRoute = async () => {
      try {
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${currentLng},${currentLat};${targetLng},${targetLat}?geometries=geojson&access_token=${MAPBOX_TOKEN}`;
        const res = await axios.get(url);
        const data = res.data.routes[0];
        
        if (data) {
          const routeGeojson = {
            type: 'Feature',
            properties: {},
            geometry: data.geometry
          };
          const source = mapInst.current?.getSource('route') as mapboxgl.GeoJSONSource;
          if (source) {
            source.setData(routeGeojson as any);
          }
          
          setEta(Math.round(data.duration / 60) + ' min');
          setDistance((data.distance / 1000).toFixed(1) + ' km');
        }
      } catch (err) {
        console.error('Failed to fetch directions', err);
      }
    };

    fetchRoute();
    
    // We update route every time current location changes by a significant amount (but since we sim, we'll just debounce it)
    const intervalId = setInterval(fetchRoute, 10000);
    return () => clearInterval(intervalId);
  }, [currentLat, currentLng, targetLat, targetLng, shiftStatus]);

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] relative">
      <div className="flex-1 bg-surface border border-border rounded-2xl overflow-hidden relative shadow-lg">
        <div ref={mapRef} className="w-full h-full bg-slate-900" />
        
        <div className="absolute bottom-0 inset-x-0 p-6 bg-gradient-to-t from-black via-black/80 to-transparent">
           <h2 className="text-2xl font-black uppercase italic drop-shadow-md">Route to Destination</h2>
           <div className="grid grid-cols-3 gap-4 mt-4">
              <div className="bg-surface2/80 p-3 rounded-xl border border-white/10 backdrop-blur-md">
                 <p className="text-[9px] text-muted uppercase tracking-widest">ETA</p>
                 <p className="font-black">{eta}</p>
              </div>
              <div className="bg-surface2/80 p-3 rounded-xl border border-white/10 backdrop-blur-md">
                 <p className="text-[9px] text-muted uppercase tracking-widest">Remaining</p>
                 <p className="font-black">{distance}</p>
              </div>
              <div className="bg-surface2/80 p-3 rounded-xl border border-white/10 backdrop-blur-md">
                 <p className="text-[9px] text-muted uppercase tracking-widest">Speed</p>
                 <p className="font-black text-primary">{shiftStatus === 'ON_MISSION' ? speed : '0'} km/h</p>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}
