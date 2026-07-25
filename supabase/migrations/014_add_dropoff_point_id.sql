ALTER TABLE public.capacity_bids ADD COLUMN dropoff_point_id UUID REFERENCES public.delivery_points(id);
