import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import WebSocket from 'ws';

globalThis.WebSocket = WebSocket as any;
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
  const { data, error } = await supabase
    .from('shipments')
    .update({
      dest_name: 'Customer Warehouse',
      dest_address: 'Lat: 28.7041, Lng: 77.1025 (New Delhi)',
      dest_lat: 28.7041,
      dest_lng: 77.1025,
      drop_location: {
        address: 'Lat: 28.7041, Lng: 77.1025 (New Delhi)'
      }
    })
    .eq('tracking_id', 'RTX-CFE939A9')
    .select();

  if (error) {
    console.error('Update failed:', error);
  } else {
    console.log('Successfully updated RTX-CFE939A9:', data);
  }
}

run();
