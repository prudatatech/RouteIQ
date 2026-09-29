import { settings } from '../core/config';
import { cacheGet, cacheSet } from '../core/redis';
import { externalHttp } from '../core/http';
import { isValidPoint, LatLng } from './geo';

/** Severity at or above this counts as severe weather (storm, heavy rain, snow, dense fog, very strong wind). */
export const SEVERE_WEATHER_THRESHOLD = 0.6;
const CACHE_TTL_SECONDS = 15 * 60;

export interface WeatherConditions {
  configured: true;
  condition: string;
  description: string;
  temperature_c: number | null;
  wind_kmph: number | null;
  visibility_m: number | null;
  rain_mm_per_hour: number | null;
  /** 0 (clear) to 1 (dangerous), from the OpenWeather condition code, wind and visibility. */
  severity: number;
  severe: boolean;
  observed_at: string;
}

export type WeatherResult = WeatherConditions | { configured: false } | { configured: true; unavailable: true };

/** Maps an OpenWeather condition id to a 0-1 severity. See https://openweathermap.org/weather-conditions */
export function severityFromCode(id: number): number {
  if (id >= 200 && id < 300) return 0.9; // thunderstorm
  if (id === 502 || id === 503 || id === 504 || id === 522 || id === 531) return 0.7; // heavy rain
  if (id >= 500 && id < 600) return 0.4; // rain
  if (id >= 300 && id < 400) return 0.2; // drizzle
  if (id === 602 || id === 622 || (id >= 611 && id <= 616)) return 0.7; // heavy snow, sleet
  if (id >= 600 && id < 700) return 0.6; // snow
  if (id === 741) return 0.5; // fog
  if (id === 781 || id === 771) return 1; // tornado, squall
  if (id === 751 || id === 761 || id === 762) return 0.5; // sand, dust, ash
  if (id >= 700 && id < 800) return 0.3; // mist, haze, smoke
  return 0;
}

export function severityFromReading(id: number, windKmph: number | null, visibilityM: number | null): number {
  let s = severityFromCode(id);
  if (windKmph !== null && windKmph >= 60) s = Math.max(s, 0.7);
  else if (windKmph !== null && windKmph >= 40) s = Math.max(s, 0.4);
  if (visibilityM !== null && visibilityM < 200) s = Math.max(s, 0.7);
  else if (visibilityM !== null && visibilityM < 1000) s = Math.max(s, 0.5);
  return s;
}

export function isWeatherConfigured(): boolean {
  return !!settings.OPENWEATHER_API_KEY;
}

export function isConditions(w: WeatherResult): w is WeatherConditions {
  return w.configured === true && !('unavailable' in w);
}

/** Current conditions at a point, cached for 15 minutes per ~11 km grid cell. */
export async function getWeather(p: LatLng): Promise<WeatherResult> {
  if (!isWeatherConfigured()) return { configured: false };
  if (!isValidPoint(p)) return { configured: true, unavailable: true };

  const key = `weather:${p.lat.toFixed(1)}:${p.lng.toFixed(1)}`;
  const cached = await cacheGet<WeatherConditions>(key);
  if (cached) return cached;

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${p.lat}&lon=${p.lng}&units=metric&appid=${encodeURIComponent(settings.OPENWEATHER_API_KEY)}`;
    const data = await externalHttp.getJson<any>(url);
    const w = data?.weather?.[0];
    if (!w || typeof w.id !== 'number') return { configured: true, unavailable: true };
    const windKmph = typeof data.wind?.speed === 'number' ? Math.round(data.wind.speed * 3.6) : null;
    const visibility = typeof data.visibility === 'number' ? data.visibility : null;
    const severity = severityFromReading(w.id, windKmph, visibility);
    const result: WeatherConditions = {
      configured: true,
      condition: String(w.main ?? ''),
      description: String(w.description ?? ''),
      temperature_c: typeof data.main?.temp === 'number' ? Math.round(data.main.temp * 10) / 10 : null,
      wind_kmph: windKmph,
      visibility_m: visibility,
      rain_mm_per_hour: typeof data.rain?.['1h'] === 'number' ? data.rain['1h'] : null,
      severity,
      severe: severity >= SEVERE_WEATHER_THRESHOLD,
      observed_at: new Date().toISOString(),
    };
    await cacheSet(key, result, CACHE_TTL_SECONDS);
    return result;
  } catch (e) {
    console.warn('[weather] OpenWeather request failed:', (e as Error).message);
    return { configured: true, unavailable: true };
  }
}

/** Worst live severity across a few points (for example a depot and the centre of its stops). Null when weather is not available. */
export async function liveWeatherAt(points: LatLng[]): Promise<{ severity: number; description: string; condition: string } | null> {
  let worst: WeatherConditions | null = null;
  for (const p of points) {
    const w = await getWeather(p);
    if (isConditions(w) && (!worst || w.severity > worst.severity)) worst = w;
  }
  return worst ? { severity: worst.severity, description: worst.description, condition: worst.condition } : null;
}
