-- A return trip a driver opens from the app has no minimum price: bids of any amount are welcome,
-- and capacity.service already treats a null floor_price as "no minimum". The column was NOT NULL,
-- so driver-opened windows failed with a 500. Staff-opened windows still set a floor.
ALTER TABLE public.capacity_windows ALTER COLUMN floor_price DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
