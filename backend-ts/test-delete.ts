import { supabase } from './src/core/supabase';
import { ShipmentService } from './src/services/shipment.service';

async function run() {
  const { data } = await supabase.from('shipments').select('id').eq('tracking_id', 'RTX-NT8FVV2').single();
  if (data) {
    try {
      const res = await ShipmentService.deleteShipment(data.id);
      console.log('Delete result:', res);
    } catch (e: any) {
      console.log('Error deleting:', e.message);
    }
  } else {
    console.log('Shipment not found in DB!');
  }
}
run();
