-- One live vehicle per driver.
--
-- A driver's first login creates a TEMP-… placeholder vehicle (auth.routes.ts),
-- and the Fleet wizard could then create a second, real vehicle for the same
-- phone. Endpoints that look up "the driver's vehicle" with .single() (SOS,
-- ping, break, my route) then failed for that driver. The backend now adopts
-- the placeholder when the real vehicle is created; this migration cleans up
-- the drivers who already have two and makes the rule hold in the database.
--
-- Step 1 (dedupe), for each driver with more than one non-archived vehicle:
--   keep the newest non-TEMP vehicle (or the newest TEMP one if all are TEMP);
--   archive the other TEMP-… placeholders and release their driver;
--   for any other extra real vehicle, only release the driver (the vehicle
--   stays in the fleet, unassigned) - a real vehicle is never archived here.
-- Step 2: a partial unique index so it cannot happen again.
--
-- Safe to re-run. Not yet applied to the live project.

WITH ranked AS (
  SELECT
    id,
    driver_id,
    plate_number,
    ROW_NUMBER() OVER (
      PARTITION BY driver_id
      ORDER BY (plate_number ILIKE 'TEMP-%') ASC, updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id
    ) AS rn
  FROM public.vehicles
  WHERE driver_id IS NOT NULL
    AND status <> 'archived'
)
UPDATE public.vehicles v
SET
  status = CASE WHEN r.plate_number ILIKE 'TEMP-%' THEN 'archived'::public.vehicle_status ELSE v.status END,
  driver_id = NULL
FROM ranked r
WHERE v.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS vehicles_one_live_vehicle_per_driver
  ON public.vehicles (driver_id)
  WHERE driver_id IS NOT NULL AND status <> 'archived';
