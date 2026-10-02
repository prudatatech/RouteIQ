import { randomUUID } from 'node:crypto';
import { indianDateKey } from '../../src/core/istDate';

const DAY = 86_400_000;
export const tomorrow = () => indianDateKey(new Date(Date.now() + DAY));

/** A valid load draft: Mumbai to Delhi, four products totalling 20,900 kg and 7,62,500 rupees. */
export function draft(over: Record<string, unknown> = {}) {
  return {
    client_request_id: randomUUID(),
    items: [
      { product_name: 'Cement bags', hsn_code: '2523', gst_rate: 18, quantity: 400, unit: 'bags', weight_kg: 20000, declared_value: 700000 },
      { product_name: 'Paint tins', hsn_code: '3208', gst_rate: 18, quantity: 50, unit: 'tins', weight_kg: 500, declared_value: 50000 },
      { product_name: 'Tiles', hsn_code: '6907', gst_rate: 18, quantity: 10, unit: 'boxes', weight_kg: 300, declared_value: 10000 },
      { product_name: 'Fasteners', hsn_code: '7318', gst_rate: 18, quantity: 1, unit: 'box', weight_kg: 100, declared_value: 2500 },
    ],
    pickup_city: 'Mumbai', pickup_address: 'Plot 4, MIDC Andheri', pickup_pincode: '400093', pickup_lat: 19.1197, pickup_lng: 72.8464,
    pickup_date: tomorrow(), pickup_slot: 'morning', pickup_contact_name: 'Ravi', pickup_contact_phone: '+919800000000',
    delivery_city: 'Delhi', delivery_address: 'Warehouse 2, Okhla', delivery_pincode: '110020', delivery_lat: 28.5355, delivery_lng: 77.275,
    vehicle_class: 'sxl_32', load_type: 'ftl',
    ...over,
  };
}
