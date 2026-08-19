import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../core/supabase';
import crypto from 'crypto';

async function seed() {
  console.log('🌱 Starting Master Data Seed...');

  try {
    // 1. Create Depots (Nodes for VRP solver)
    const depots = [
      {
        id: uuidv4(),
        name: 'Delhi Central Hub',
        address: 'NH-48, Delhi',
        latitude: 28.6139,
        longitude: 77.2090,
      },
      {
        id: uuidv4(),
        name: 'Mumbai Port Depot',
        address: 'JNPT, Mumbai',
        latitude: 19.0760,
        longitude: 72.8777,
      },
    ];

    console.log('Inserting Depots...');
    const { error: depotErr } = await supabase.from('depots').upsert(depots, { onConflict: 'id' });
    if (depotErr) throw depotErr;
    console.log(`✅ Inserted ${depots.length} depots.`);

    // 2. Create Users (Drivers)
    console.log('Inserting Drivers...');

    const drivers = [
      {
        id: uuidv4(),
        email: 'driver1@margixindia.com',
        phone: '+919876543210',
        full_name: 'Rajesh Kumar',
        role: 'driver',
        is_active: true,
      },
      {
        id: uuidv4(),
        email: 'driver2@margixindia.com',
        phone: '+919876543211',
        full_name: 'Suresh Singh',
        role: 'driver',
        is_active: true,
      },
    ];

    const { error: userErr } = await supabase.from('users').upsert(drivers, { onConflict: 'id' });
    if (userErr) throw userErr;
    console.log(`✅ Inserted ${drivers.length} drivers.`);

    // 3. Create Vehicles
    console.log('Inserting Vehicles...');

    // We need to fetch the newly created drivers to get their UUIDs if they were upserted
    const { data: dbDrivers, error: getDrErr } = await supabase.from('users').select('id, email').in('email', ['driver1@margixindia.com', 'driver2@margixindia.com']);
    if (getDrErr) throw getDrErr;

    const getDriverId = (email: string) => dbDrivers?.find(d => d.email === email)?.id;

    const vehicles = [
      {
        id: uuidv4(),
        plate_number: 'DL-1M-4455',
        vehicle_type: 'truck',
        capacity_kg: 5000,
        available_capacity_kg: 5000,
        status: 'available',
        fuel_type: 'diesel',
        fuel_capacity_liters: 200,
        fuel_efficiency_kmpl: 6,
        current_fuel_liters: 180,
        latitude: 28.6139,
        longitude: 77.2090,
        driver_id: getDriverId('driver1@margixindia.com'),
      },
      {
        id: uuidv4(),
        plate_number: 'MH-02-AB-1234',
        vehicle_type: 'van',
        capacity_kg: 2000,
        available_capacity_kg: 2000,
        status: 'available',
        fuel_type: 'diesel',
        fuel_capacity_liters: 80,
        fuel_efficiency_kmpl: 12,
        current_fuel_liters: 70,
        latitude: 19.0760,
        longitude: 72.8777,
        driver_id: getDriverId('driver2@margixindia.com'),
      },
      {
        id: uuidv4(),
        plate_number: 'KA-01-CD-5678',
        vehicle_type: 'truck',
        capacity_kg: 10000,
        available_capacity_kg: 10000,
        status: 'available',
        fuel_type: 'diesel',
        fuel_capacity_liters: 300,
        fuel_efficiency_kmpl: 4,
        current_fuel_liters: 250,
        latitude: 28.7041,
        longitude: 77.1025,
        driver_id: null, // Unassigned
      }
    ];

    const { error: vehErr } = await supabase.from('vehicles').upsert(vehicles, { onConflict: 'id' });
    if (vehErr) throw vehErr;
    console.log(`✅ Inserted ${vehicles.length} vehicles.`);

    console.log('🎉 Seed completed successfully!');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
  } finally {
    process.exit();
  }
}

seed();
