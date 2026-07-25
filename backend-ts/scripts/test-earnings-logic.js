const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
globalThis.WebSocket = WebSocket;
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  try {
    const userId = 'a7b38f7f-214d-4c18-bd0e-98ac21ab10c3';
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('id')
      .eq('driver_id', userId);

    const vehicleIds = vehicles.map(v => v.id);
    console.log('Vehicle IDs:', vehicleIds);

    const { data: cargoTrips, error: err1 } = await supabase
      .from('cargo_manifest')
      .select('*')
      .in('vehicle_id', vehicleIds)
      .eq('status', 'delivered')
      .order('updated_at', { ascending: false });
    if (err1) console.error('err1:', err1);

    const { data: routeTrips, error: err2 } = await supabase
      .from('routes')
      .select('*')
      .in('vehicle_id', vehicleIds)
      .eq('status', 'completed')
      .order('updated_at', { ascending: false });
    if (err2) console.error('err2:', err2);

    const allTrips = [
      ...(cargoTrips || []).map(t => ({ ...t, type: 'cargo' })),
      ...(routeTrips || []).map(t => ({ ...t, type: 'route' }))
    ].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

    console.log('allTrips:', allTrips.length);
    
    let totalEarningsCalc = 0;
    const getStableCost = (id) => {
        const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return (hash % 3000) + 1500;
    };

    totalEarningsCalc = allTrips.reduce((sum, t) => sum + (t.cost || getStableCost(t.id)), 0);
    console.log('totalEarningsCalc:', totalEarningsCalc);

    const realInvoices = allTrips.slice(0, 10).map((t) => {
        const generatedCost = t.cost || getStableCost(t.id);
        return {
          id: `INV-${t.id.split('-')[0].toUpperCase()}`,
          date: t.updated_at,
          pickup: t.pickup_location || 'Terminal Hub',
          drop: t.drop_location || 'Customer Location',
          cargo_type: t.type === 'cargo' ? 'General Goods' : 'Assigned Route',
          weight_tons: t.capacity_kg ? (t.capacity_kg / 1000).toFixed(1) : 1,
          distance_km: (getStableCost(t.id) % 50) + 20, // stable distance
          base_pay: generatedCost,
          bonus: 0,
          tax: 0,
          total_payout: generatedCost,
          status: 'paid'
        };
    });

    console.log('Success!');
  } catch (e) {
    console.error('CRASH:', e);
  }
}
main();
