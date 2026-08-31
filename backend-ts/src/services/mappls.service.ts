import { settings } from '../core/config';
import { cacheGet, cacheSet } from '../core/redis';

export class MapplsService {
  private static OAUTH_URL = 'https://outpost.mappls.com/api/security/oauth/token';
  private static ADVANCED_MAPS_URL = 'https://apis.mappls.com/advancedmaps/v1';

  /**
   * Fetches the Mappls OAuth token using client credentials.
   * Caches the token to avoid rate limits and improve performance.
   */
  static async getAccessToken(): Promise<string> {
    const cachedToken = await cacheGet<string>('MAPPLS_ACCESS_TOKEN');
    if (cachedToken) {
      return cachedToken;
    }

    if (!settings.MAPPLS_CLIENT_ID || !settings.MAPPLS_CLIENT_SECRET) {
      throw new Error('Mappls credentials missing in configuration.');
    }

    const response = await fetch(this.OAUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `grant_type=client_credentials&client_id=${settings.MAPPLS_CLIENT_ID}&client_secret=${settings.MAPPLS_CLIENT_SECRET}`
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Mappls token: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Cache the token slightly shorter than its actual expiry (e.g. 5 minutes before)
    const expirySeconds = data.expires_in - 300; 
    await cacheSet('MAPPLS_ACCESS_TOKEN', data.access_token, expirySeconds > 0 ? expirySeconds : 3600);

    return data.access_token;
  }

  /**
   * Get driving route between two points
   * @param origin {lat, lng}
   * @param dest {lat, lng}
   */
  static async getRouting(origin: {lat: number, lng: number}, dest: {lat: number, lng: number}): Promise<any> {
    const token = await this.getAccessToken();
    const url = `${this.ADVANCED_MAPS_URL}/${token}/route_adv/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Mappls Routing API error: ${response.statusText}`);
    
    return await response.json();
  }

  /**
   * Get distance matrix (one-to-many or many-to-many)
   * @param coords Array of coordinate strings in format "lng,lat"
   * @param sources Index of the source coordinate in the array
   * @param destinations Index array of destination coordinates
   */
  static async getDistanceMatrix(coords: string[], sources: number[] = [0], destinations: number[] = []): Promise<any> {
    const token = await this.getAccessToken();
    const coordsStr = coords.join(';');
    
    let url = `${this.ADVANCED_MAPS_URL}/${token}/distance_matrix/driving/${coordsStr}`;
    
    const params = new URLSearchParams();
    if (sources.length > 0) params.append('sources', sources.join(';'));
    if (destinations.length > 0) params.append('destinations', destinations.join(';'));
    
    const qs = params.toString();
    if (qs) url += `?${qs}`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Mappls Distance Matrix API error: ${response.statusText}`);
    
    return await response.json();
  }

  /**
   * Geocode a text address into coordinates
   * @param address Full address string
   */
  static async getGeocoding(address: string): Promise<any> {
    const token = await this.getAccessToken();
    const url = `https://atlas.mappls.com/api/places/geocode?address=${encodeURIComponent(address)}`;
    
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`Mappls Geocode API error: ${response.statusText}`);
    
    return await response.json();
  }
}
