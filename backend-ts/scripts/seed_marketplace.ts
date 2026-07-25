import { supabase } from '../src/core/supabase';
import crypto from 'crypto';

async function seedMarketplace() {
  console.log('Seeding marketplace loads...');

  // 1. Create a mock marketplace shipment 1
  const shipmentId1 = crypto.randomUUID();
  const dpId1 = crypto.randomUUID();

  await supabase.from('shipments').insert({
    id: shipmentId1,
    tracking_id: 'MKT-LOAD-001',
    status: 'created',
    priority: 'high',
    origin_name: 'Bhiwandi Textile Hub',
    origin_address: 'Bhiwandi, Maharashtra',
    origin_lat: 19.3000,
    origin_lng: 73.0600,
    total_items: 5,
    total_weight_kg: 800,
  });

  await supabase.from('delivery_points').insert({
    id: dpId1,
    name: 'South Mumbai Retailer',
    address: 'Colaba, Mumbai',
    latitude: 18.9100,
    longitude: 72.8100,
    demand_kg: 800,
    service_time_minutes: 20,
    status: 'pending',
    shipment_id: shipmentId1
  });

  console.log('Inserted Load 1: Bhiwandi -> Colaba (800kg)');

  // 2. Create a mock marketplace shipment 2
  const shipmentId2 = crypto.randomUUID();
  const dpId2 = crypto.randomUUID();

  await supabase.from('shipments').insert({
    id: shipmentId2,
    tracking_id: 'MKT-LOAD-002',
    status: 'created',
    priority: 'medium',
    origin_name: 'Navi Mumbai Electronics',
    origin_address: 'Vashi, Navi Mumbai',
    origin_lat: 19.0700,
    origin_lng: 73.0000,
    total_items: 2,
    total_weight_kg: 350,
  });

  await supabase.from('delivery_points').insert({
    id: dpId2,
    name: 'Andheri Tech Park',
    address: 'Andheri East, Mumbai',
    latitude: 19.1136,
    longitude: 72.8697,
    demand_kg: 350,
    service_time_minutes: 15,
    status: 'pending',
    shipment_id: shipmentId2
  });

  console.log('Inserted Load 2: Vashi -> Andheri (350kg)');
  console.log('Marketplace seeding complete!');
}

seedMarketplace();
