/**
 * margixindia — Pin code to state. The full pin code first (public.pincodes, filled from the India Post directory),
 * then its 3-digit prefix (public.pincode_prefixes, the postal-circle map).
 */
import { supabase } from '../../core/supabase';
import { GST_STATES } from '../../core/gst';
import { loadPincodePrefixes, PincodePrefix } from './master';

export interface PincodeInfo {
  pincode: string;
  state_code: string;
  state_name: string;
  district?: string;
  city?: string;
}

export const isPincode = (v: unknown): v is string => typeof v === 'string' && /^[1-9][0-9]{5}$/.test(v.trim());

/** The state of a pin code from the prefix map alone (pure; the map is passed in). */
export function pincodeFromPrefix(pin: string, prefixes: Map<string, PincodePrefix>): PincodeInfo | null {
  if (!isPincode(pin)) return null;
  const hit = prefixes.get(pin.trim().slice(0, 3));
  return hit ? { pincode: pin.trim(), state_code: hit.state_code, state_name: hit.state_name } : null;
}

/** Looks a pin code up: an exact row first, then the prefix. null when neither knows it or the pin is malformed. */
export async function lookupPincode(pin: string): Promise<PincodeInfo | null> {
  if (!isPincode(pin)) return null;
  const code = pin.trim();
  const { data, error } = await supabase.from('pincodes').select('pincode, district, city, state_code, state_name').eq('pincode', code).maybeSingle();
  if (error) throw new Error(`Failed to read pincodes: ${error.message}`);
  if (data) {
    const row = data as any;
    return {
      pincode: code,
      state_code: row.state_code,
      state_name: row.state_name ?? GST_STATES[row.state_code] ?? '',
      ...(row.district ? { district: row.district } : {}),
      ...(row.city ? { city: row.city } : {}),
    };
  }
  return pincodeFromPrefix(code, await loadPincodePrefixes());
}
