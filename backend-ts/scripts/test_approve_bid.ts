import { supabase } from '../src/core/supabase';
import { capacityService } from '../src/services/capacity.service';

async function testApprove() {
  const { data: bids } = await supabase.from('capacity_bids').select('*').eq('status', 'pending').limit(1);
  if (!bids || bids.length === 0) {
    console.log("No pending bids found to test.");
    return;
  }
  
  const bidToTest = bids[0];
  console.log("Testing approval for bid:", bidToTest.id);
  
  try {
    const res = await capacityService.approveBid(bidToTest.id);
    console.log("Successfully approved!", res);
  } catch (error: any) {
    console.error("Error during approveBid:", error.message, error.stack);
  }
}

testApprove();
