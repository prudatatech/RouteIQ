import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { useMobileLocation } from '../hooks/useMobileLocation';
import 'maplibre-gl/dist/maplibre-gl.css';

const LiveMapPage: React.FC = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<maplibregl.Map | null>(null);
  const mobileMarkerRef = useRef<maplibregl.Marker | null>(null);
  const { position, error, enabled } = useMobileLocation();

  useEffect(() => {
    if (mapContainer.current && !mapInstance.current) {
      mapInstance.current = new maplibregl.Map({
        container: mapContainer.current,
        style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
        center: [0, 0],
        zoom: 2,
      });
    }

    const ws = new WebSocket(`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/updates`);
    ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (mapInstance.current && data.lat && data.lng) {
        const el = document.createElement('div');
        el.style.width = '12px';
        el.style.height = '12px';
        el.style.backgroundColor = '#B38700';
        el.style.borderRadius = '50%';
        new maplibregl.Marker(el).setLngLat([data.lng, data.lat]).addTo(mapInstance.current);
      }
    });
  }, []);

  // Effect to add mobile GPS marker when position updates
  useEffect(() => {
    if (!enabled || !position || !mapInstance.current) return;
    const el = document.createElement('div');
    el.style.width = '14px';
    el.style.height = '14px';
    el.style.backgroundColor = '#ff6600'; // distinct color for mobile GPS
    el.style.borderRadius = '50%';
    el.style.boxShadow = '0 0 8px rgba(255,102,0,0.7)';
    // Remove previous marker if exists
    if (mobileMarkerRef.current) {
      mobileMarkerRef.current.remove();
    }
    mobileMarkerRef.current = new maplibregl.Marker(el).setLngLat([position.lng, position.lat]).addTo(mapInstance.current);
  }, [position, enabled]);

  return <div className="h-screen w-full" ref={mapContainer} />;
};

export default LiveMapPage;
