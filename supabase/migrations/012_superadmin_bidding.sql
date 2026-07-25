-- Migration: 012_superadmin_bidding

-- Drop the old constraint
DO $$ 
DECLARE
  const_name text;
BEGIN
  SELECT conname INTO const_name 
  FROM pg_constraint 
  WHERE conrelid = 'capacity_windows'::regclass AND contype = 'c';
  
  IF const_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE capacity_windows DROP CONSTRAINT ' || const_name;
  END IF;
END $$;

-- Add the new constraint with superadmin_dispatch
ALTER TABLE capacity_windows 
ADD CONSTRAINT capacity_windows_trigger_type_check 
CHECK (trigger_type IN ('mid_route', 'return_trip', 'superadmin_dispatch'));

-- Force schema reload dummy columns
ALTER TABLE capacity_windows ADD COLUMN dummy2 text;
ALTER TABLE capacity_windows DROP COLUMN dummy2;

NOTIFY pgrst, 'reload schema';
