// Map Configuration Constants
export const INDIA_POSITIONS: { lng: number; lat: number; city: string }[] = [
  { lng: 77.2090, lat: 28.6139, city: 'Delhi' },
  { lng: 72.8777, lat: 19.0760, city: 'Mumbai' },
  { lng: 80.2707, lat: 13.0827, city: 'Chennai' },
  { lng: 88.3639, lat: 22.5726, city: 'Kolkata' },
  { lng: 77.5946, lat: 12.9716, city: 'Bangalore' },
  { lng: 78.4867, lat: 17.3850, city: 'Hyderabad' },
  { lng: 73.8567, lat: 18.5204, city: 'Pune' },
  { lng: 75.7873, lat: 26.9124, city: 'Jaipur' },
  { lng: 72.5714, lat: 23.0225, city: 'Ahmedabad' },
  { lng: 85.8245, lat: 20.2961, city: 'Bhubaneswar' },
]

export const STATUS_COLORS: Record<string, string> = {
  on_route:    '#F9C935',
  available:   '#10b981',
  idle:        '#94a3b8',
  maintenance: '#f59e0b',
  offline:     '#ef4444',
  gps_off:     '#ef4444',
}

export const CARGO_COLORS: Record<string, string> = {
  general:    '#F9C935', // Yellow
  cold_chain: '#3b82f6', // Blue
  hazardous:  '#f97316', // Orange
}

export const CARGO_EMOJI: Record<string, string> = {
  general:    '📦',
  cold_chain: '❄️',
  hazardous:  '⚠️',
}

export const VEHICLE_EMOJI: Record<string, string> = {
  truck: '🚛',
  van:   '🚐',
  bike:  '🏍️',
  car:   '🚗',
}

export const MAP_DEFAULTS = {
  CENTER: [
    Number(import.meta.env.VITE_MAP_CENTER_LNG || 81.0),
    Number(import.meta.env.VITE_MAP_CENTER_LAT || 22.5)
  ] as [number, number],
  ZOOM: Number(import.meta.env.VITE_MAP_ZOOM || 4.2),
  MIN_ZOOM: 3,
  MAX_ZOOM: 16,
}
