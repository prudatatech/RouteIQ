/**
 * Migration: Add assigned_vehicle_id to vendor_shipment_requests
 *            and create cargo_manifest table
 * Run: npx ts-node scripts/migrate_vendor_assign.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: 'public' } }
);

async function run() {
  console.log('🔧 Running migration...');
  
  // Step 1: Test if assigned_vehicle_id exists
  const { error: testErr } = await supabase
    .from('vendor_shipment_requests')
    .select('assigned_vehicle_id')
    .limit(1);
  
  if (testErr && testErr.message.includes('does not exist')) {
    console.log('➕ assigned_vehicle_id column missing, need to add via Supabase dashboard SQL Editor');
    console.log('\nRun this SQL in Supabase Dashboard > SQL Editor:\n');
    console.log('─'.repeat(60));
    console.log(`
-- 1. Add assigned_vehicle_id to vendor_shipment_requests
ALTER TABLE vendor_shipment_requests 
  ADD COLUMN IF NOT EXISTS assigned_vehicle_id uuid 
  REFERENCES vehicles(id) ON DELETE SET NULL;

-- 2. Create cargo_manifest table
CREATE TABLE IF NOT EXISTS cargo_manifest (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  vendor_request_id uuid REFERENCES vendor_shipment_requests(id) ON DELETE SET NULL,
  pickup_location text,
  pickup_lat float8,
  pickup_lng float8,
  drop_location text,
  drop_lat float8,
  drop_lng float8,
  capacity_kg float8,
  status text DEFAULT 'scheduled',
  created_at timestamptz DEFAULT now()
);

-- 3. RLS
ALTER TABLE cargo_manifest ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "cargo_manifest_admin"
  ON cargo_manifest FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
    `);
    console.log('─'.repeat(60));
  } else if (!testErr) {
    console.log('✅ assigned_vehicle_id column already exists');
  } else {
    console.error('Unexpected error:', testErr);
  }

  // Step 2: Check cargo_manifest
  const { error: cme } = await supabase.from('cargo_manifest').select('id').limit(1);
  if (cme && cme.message.includes('does not exist')) {
    console.log('⚠️  cargo_manifest table does not exist either — use the SQL above to create it');
  } else if (!cme) {
    console.log('✅ cargo_manifest table exists');
  }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
