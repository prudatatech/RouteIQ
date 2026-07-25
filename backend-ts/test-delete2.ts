import { supabase } from './src/core/supabase';
async function run() {
  const { data } = await supabase.from('shipments').select('id').eq('tracking_id', 'RTX-NT8FVV2').single();
  if (data) {
    const { error } = await supabase.from('shipments').delete().eq('id', data.id);
    console.log('Delete error:', error);
  }
}
run();
