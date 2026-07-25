import axios from 'axios';
import { settings } from '../core/config';
import polyline from '@mapbox/polyline';

export interface RouteMatchResult {
  vendor_id: string;
  min_distance_km: number;
}

export const mapsService = {
  /**
   * Fetch a route polyline from Google Maps Directions API
   */
  async getRoutePolyline(originLat: number, originLng: number, destLat: number, destLng: number): Promise<string> {
    if (!settings.GOOGLE_MAPS_API_KEY) {
      console.warn('GOOGLE_MAPS_API_KEY is not set. Returning empty polyline.');
      return '';
    }

    try {
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originLat},${originLng}&destination=${destLat},${destLng}&key=${settings.GOOGLE_MAPS_API_KEY}`;
      const response = await axios.get(url);

      if (response.data.status !== 'OK') {
        console.error('Google Maps API Error:', response.data.error_message || response.data.status);
        return '';
      }

      const route = response.data.routes[0];
      return route.overview_polyline.points;
    } catch (error: any) {
      console.error('Failed to fetch route polyline:', error.message);
      return '';
    }
  },

  /**
   * Decodes a polyline and samples points every ~N items to reduce payload size
   * for the PostgREST function.
   */
  samplePolylinePoints(encodedPolyline: string, sampleRate: number = 10): { lat: number, lng: number }[] {
    if (!encodedPolyline) return [];
    
    // polyline.decode returns an array of [lat, lng] tuples
    const points = polyline.decode(encodedPolyline);
    
    const sampled = [];
    for (let i = 0; i < points.length; i += sampleRate) {
      sampled.push({ lat: points[i][0], lng: points[i][1] });
    }
    
    // Always include the exact start and end points
    if (points.length > 0 && (points.length - 1) % sampleRate !== 0) {
      sampled.push({ lat: points[points.length - 1][0], lng: points[points.length - 1][1] });
    }
    
    return sampled;
  }
};
