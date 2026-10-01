-- UAT-001 and UAT-002: one open delay case per shipment or load, and a driver pay entry for every
-- completed trip.
--
-- 1. cargo_exceptions.dedupe_key: the backend sets it on cases the system opens by itself
--    ('delay:shipment:<id>' / 'delay:manifest:<id>'). A partial unique index refuses a second
--    case with the same key while the first is open, so two scheduler ticks (or two servers)
--    cannot both open a delay case for the same goods.
-- 2. Clean-up of what is already there: open delay cases on goods that are delivered, cancelled,
--    returned or lost are resolved (with a note and a line in the audit log), and when two open
--    delay cases cover the same goods only the oldest is kept. Existing open delay cases of
--    one shipment or load then get their key.
-- 3. Backfill of driver_pay_entries for completed routes and delivered vendor loads that have none
--    (trips finished before driver pay shipped, or on a vehicle that had no driver then). The
--    distance is the planned one, else the stops in a line (km_source 'planned' or 'estimated';
--    driven km needs the GPS clean-up the backend does, so use the staff "backfill" for those).
--    Trips whose vehicle type has no rate are 0 and flagged rate_missing, the same as the backend.
--
-- Idempotent: safe to re-run. NOT applied yet. Apply this before deploying the backend that sets
-- dedupe_key, or opening a delay case fails until it is applied.

-- ── 1. dedupe_key ───────────────────────────────────────────
ALTER TABLE public.cargo_exceptions ADD COLUMN IF NOT EXISTS dedupe_key text;

-- ── 2. Resolve open delay cases on settled goods ────────────
DO $$
DECLARE
  closed integer;
BEGIN
  WITH settled AS (
    SELECT e.id
    FROM public.cargo_exceptions e
    WHERE e.type = 'delay'
      AND e.status IN ('open', 'investigating', 'action_planned')
      AND EXISTS (SELECT 1 FROM public.cargo_exception_items i WHERE i.exception_id = e.id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.cargo_exception_items i
        LEFT JOIN public.shipments s ON s.id = i.shipment_id
        LEFT JOIN public.cargo_manifest m ON m.id = i.manifest_id
        WHERE i.exception_id = e.id
          AND NOT (
            (s.id IS NOT NULL AND (
              s.status::text IN ('delivered', 'returned', 'lost', 'cancelled')
              OR (s.status::text = 'partially_delivered' AND s.pieces_total IS NOT NULL
                  AND s.pieces_total - coalesce(s.pieces_delivered, 0) - coalesce(s.pieces_short, 0) - coalesce(s.pieces_returned, 0) <= 0)
            ))
            OR (m.id IS NOT NULL AND m.status::text IN ('delivered', 'completed', 'returned', 'cancelled', 'lost'))
          )
      )
  ),
  closed_cases AS (
    UPDATE public.cargo_exceptions e
    SET status = 'resolved',
        resolution = 'no_action',
        resolution_note = 'The goods were already delivered, cancelled, returned or lost, so the delay no longer applies.',
        resolved_by = NULL,
        resolved_at = now(),
        updated_at = now(),
        notes = coalesce(e.notes, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'at', now(), 'by', NULL, 'role', 'system', 'kind', 'action',
          'text', 'Resolved automatically: the goods were already delivered, cancelled, returned or lost, so the delay no longer applies.'))
    FROM settled
    WHERE e.id = settled.id
    RETURNING e.id, e.code
  )
  INSERT INTO public.ai_agent_logs (agent_name, action, input_data, output_data, status)
  SELECT 'system', 'cargo_case.auto_resolved',
         jsonb_build_object('exception_id', c.id, 'code', c.code, 'type', 'delay', 'resolution', 'no_action', 'via', 'migration 20261001010000')::json,
         to_json(c.code || ' resolved: the goods were already settled, so the delay no longer applies.'),
         'success'
  FROM closed_cases c;
  GET DIAGNOSTICS closed = ROW_COUNT;
END $$;

-- Two open delay cases for the same goods: keep the oldest, resolve the rest as duplicates
DO $$
DECLARE
  closed integer;
BEGIN
  WITH dupes AS (
    SELECT DISTINCT e.id, o.code AS original_code
    FROM public.cargo_exceptions e
    JOIN public.cargo_exception_items i ON i.exception_id = e.id
    JOIN public.cargo_exception_items oi
      ON (oi.shipment_id IS NOT DISTINCT FROM i.shipment_id AND oi.manifest_id IS NOT DISTINCT FROM i.manifest_id AND oi.exception_id <> i.exception_id)
    JOIN public.cargo_exceptions o ON o.id = oi.exception_id
    WHERE e.type = 'delay' AND o.type = 'delay'
      AND e.status IN ('open', 'investigating', 'action_planned')
      AND o.status IN ('open', 'investigating', 'action_planned')
      AND (o.created_at, o.id) < (e.created_at, e.id)
  ),
  closed_cases AS (
    UPDATE public.cargo_exceptions e
    SET status = 'resolved',
        resolution = 'no_action',
        resolution_note = 'Duplicate of ' || d.original_code || ', which is already open for the same goods.',
        resolved_by = NULL,
        resolved_at = now(),
        updated_at = now(),
        notes = coalesce(e.notes, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'at', now(), 'by', NULL, 'role', 'system', 'kind', 'action',
          'text', 'Resolved automatically: duplicate of ' || d.original_code || ', which is already open for the same goods.'))
    FROM dupes d
    WHERE e.id = d.id
    RETURNING e.id, e.code
  )
  INSERT INTO public.ai_agent_logs (agent_name, action, input_data, output_data, status)
  SELECT 'system', 'cargo_case.auto_resolved',
         jsonb_build_object('exception_id', c.id, 'code', c.code, 'type', 'delay', 'resolution', 'no_action', 'via', 'migration 20261001010000')::json,
         to_json(c.code || ' resolved: duplicate delay case.'),
         'success'
  FROM closed_cases c;
  GET DIAGNOSTICS closed = ROW_COUNT;
END $$;

-- The delay cases still open for one shipment or load get their key
UPDATE public.cargo_exceptions e
SET dedupe_key = 'delay:' || CASE WHEN i.shipment_id IS NOT NULL THEN 'shipment:' || i.shipment_id::text ELSE 'manifest:' || i.manifest_id::text END
FROM public.cargo_exception_items i
WHERE i.exception_id = e.id
  AND e.type = 'delay'
  AND e.source = 'eta'
  AND e.dedupe_key IS NULL
  AND e.status IN ('open', 'investigating', 'action_planned')
  AND (SELECT count(*) FROM public.cargo_exception_items x WHERE x.exception_id = e.id) = 1;

CREATE UNIQUE INDEX IF NOT EXISTS cargo_exceptions_open_dedupe_key
  ON public.cargo_exceptions (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('open', 'investigating', 'action_planned');

-- ── 3. Driver pay entries for completed trips that have none ─
-- Completed routes
DO $$
DECLARE
  made integer;
BEGIN
  WITH finished AS (
    SELECT r.id AS route_id,
           v.id AS vehicle_id,
           v.vehicle_type,
           coalesce(
             v.driver_id,
             (SELECT ev.driver_id FROM public.cargo_custody_events ev
               WHERE (ev.from_vehicle_id = v.id OR ev.to_vehicle_id = v.id) AND ev.driver_id IS NOT NULL
               ORDER BY ev.recorded_at DESC LIMIT 1)
           ) AS driver_id,
           (coalesce(r.completed_at, r.updated_at, r.created_at) AT TIME ZONE 'Asia/Kolkata')::date AS trip_date,
           coalesce(r.total_distance_km, 0) AS planned_km,
           (SELECT coalesce(sum(l.leg), 0) FROM (
              SELECT 2 * 6371 * asin(least(1, sqrt(
                       power(sin(radians(dp.latitude - lag(dp.latitude) OVER w) / 2), 2)
                       + cos(radians(lag(dp.latitude) OVER w)) * cos(radians(dp.latitude))
                         * power(sin(radians(dp.longitude - lag(dp.longitude) OVER w) / 2), 2)))) AS leg
              FROM public.route_stops rs
              JOIN public.delivery_points dp ON dp.id = rs.delivery_point_id
              WHERE rs.route_id = r.id AND dp.latitude IS NOT NULL AND dp.longitude IS NOT NULL
              WINDOW w AS (ORDER BY rs.sequence)
            ) l WHERE l.leg IS NOT NULL) AS stops_km
    FROM public.routes r
    JOIN public.vehicles v ON v.id = r.vehicle_id
    WHERE r.status = 'completed'
      AND NOT EXISTS (SELECT 1 FROM public.driver_pay_entries e WHERE e.route_id = r.id)
  ),
  priced AS (
    SELECT f.*,
           CASE WHEN f.planned_km > 0 THEN round(f.planned_km::numeric, 1) ELSE round(f.stops_km::numeric, 1) END AS km,
           CASE WHEN f.planned_km > 0 THEN 'planned' WHEN f.stops_km > 0 THEN 'estimated' ELSE 'none' END AS km_source,
           rate.id AS rate_id,
           coalesce(rate.per_trip_amount, 0) AS per_trip_amount,
           coalesce(rate.per_km_amount, 0) AS per_km_amount
    FROM finished f
    LEFT JOIN LATERAL (
      SELECT dr.id, dr.per_trip_amount, dr.per_km_amount
      FROM public.driver_pay_rates dr
      WHERE dr.active AND dr.vehicle_type = f.vehicle_type AND dr.effective_from <= f.trip_date
      ORDER BY dr.effective_from DESC LIMIT 1
    ) rate ON true
    WHERE f.driver_id IS NOT NULL
  )
  INSERT INTO public.driver_pay_entries
    (driver_id, vehicle_id, vehicle_type, route_id, trip_date, km, km_source, rate_id, per_trip_amount, per_km_amount, adjustments, amount, rate_missing, status)
  SELECT p.driver_id, p.vehicle_id, p.vehicle_type, p.route_id, p.trip_date, p.km, p.km_source, p.rate_id, p.per_trip_amount, p.per_km_amount,
         '[]'::jsonb, round(p.per_trip_amount + p.per_km_amount * p.km, 2), p.rate_id IS NULL, 'earned'
  FROM priced p
  ON CONFLICT (route_id) WHERE route_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS made = ROW_COUNT;

  IF made > 0 THEN
    INSERT INTO public.ai_agent_logs (agent_name, action, input_data, output_data, status)
    VALUES ('system', 'driver_pay.backfill', '{"via":"migration 20261001010000","trips":"routes"}'::json, to_json(made || ' entries created'), 'success');
  END IF;
END $$;

-- Delivered vendor loads: one entry per journey (the master load, or a standalone one, and the vehicle),
-- made once every lot on that vehicle is done and at least one was delivered
DO $$
DECLARE
  made integer;
BEGIN
  WITH lots AS (
    SELECT coalesce(m.parent_manifest_id, m.id) AS master_id, m.vehicle_id, m.status::text AS status, m.updated_at,
           m.pickup_lat, m.pickup_lng, m.drop_lat, m.drop_lng
    FROM public.cargo_manifest m
    WHERE coalesce(m.is_master, false) = false AND m.vehicle_id IS NOT NULL
  ),
  journeys AS (
    SELECT l.master_id, l.vehicle_id,
           max(l.updated_at) AS finished_at,
           (array_agg(l.pickup_lat ORDER BY l.updated_at) FILTER (WHERE l.pickup_lat IS NOT NULL AND l.pickup_lng IS NOT NULL))[1] AS start_lat,
           (array_agg(l.pickup_lng ORDER BY l.updated_at) FILTER (WHERE l.pickup_lat IS NOT NULL AND l.pickup_lng IS NOT NULL))[1] AS start_lng,
           bool_and(l.status IN ('delivered', 'completed', 'returned', 'cancelled', 'lost')) AS all_done,
           bool_or(l.status IN ('delivered', 'completed', 'returned')) AS carried
    FROM lots l
    GROUP BY l.master_id, l.vehicle_id
  ),
  ends AS (
    SELECT j.master_id, j.vehicle_id,
           coalesce(max(2 * 6371 * asin(least(1, sqrt(
             power(sin(radians(l.drop_lat - j.start_lat) / 2), 2)
             + cos(radians(j.start_lat)) * cos(radians(l.drop_lat)) * power(sin(radians(l.drop_lng - j.start_lng) / 2), 2))))), 0) AS km
    FROM journeys j
    JOIN lots l ON l.master_id = j.master_id AND l.vehicle_id = j.vehicle_id
      AND l.status IN ('delivered', 'completed', 'returned') AND l.drop_lat IS NOT NULL AND l.drop_lng IS NOT NULL
    WHERE j.start_lat IS NOT NULL
    GROUP BY j.master_id, j.vehicle_id, j.start_lat, j.start_lng
  ),
  finished AS (
    SELECT j.master_id, v.id AS vehicle_id, v.vehicle_type,
           coalesce(
             v.driver_id,
             (SELECT ev.driver_id FROM public.cargo_custody_events ev
               WHERE (ev.from_vehicle_id = v.id OR ev.to_vehicle_id = v.id) AND ev.driver_id IS NOT NULL
               ORDER BY ev.recorded_at DESC LIMIT 1)
           ) AS driver_id,
           (j.finished_at AT TIME ZONE 'Asia/Kolkata')::date AS trip_date,
           round(coalesce(e.km, 0)::numeric, 1) AS km
    FROM journeys j
    JOIN public.vehicles v ON v.id = j.vehicle_id
    LEFT JOIN ends e ON e.master_id = j.master_id AND e.vehicle_id = j.vehicle_id
    WHERE j.all_done AND j.carried
      AND NOT EXISTS (SELECT 1 FROM public.driver_pay_entries x WHERE x.manifest_id = j.master_id AND x.vehicle_id = j.vehicle_id)
  ),
  priced AS (
    SELECT f.*, rate.id AS rate_id, coalesce(rate.per_trip_amount, 0) AS per_trip_amount, coalesce(rate.per_km_amount, 0) AS per_km_amount
    FROM finished f
    LEFT JOIN LATERAL (
      SELECT dr.id, dr.per_trip_amount, dr.per_km_amount
      FROM public.driver_pay_rates dr
      WHERE dr.active AND dr.vehicle_type = f.vehicle_type AND dr.effective_from <= f.trip_date
      ORDER BY dr.effective_from DESC LIMIT 1
    ) rate ON true
    WHERE f.driver_id IS NOT NULL
  )
  INSERT INTO public.driver_pay_entries
    (driver_id, vehicle_id, vehicle_type, manifest_id, trip_date, km, km_source, rate_id, per_trip_amount, per_km_amount, adjustments, amount, rate_missing, status)
  SELECT p.driver_id, p.vehicle_id, p.vehicle_type, p.master_id, p.trip_date, p.km, CASE WHEN p.km > 0 THEN 'estimated' ELSE 'none' END,
         p.rate_id, p.per_trip_amount, p.per_km_amount, '[]'::jsonb, round(p.per_trip_amount + p.per_km_amount * p.km, 2), p.rate_id IS NULL, 'earned'
  FROM priced p
  ON CONFLICT (manifest_id, vehicle_id) WHERE manifest_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS made = ROW_COUNT;

  IF made > 0 THEN
    INSERT INTO public.ai_agent_logs (agent_name, action, input_data, output_data, status)
    VALUES ('system', 'driver_pay.backfill', '{"via":"migration 20261001010000","trips":"vendor loads"}'::json, to_json(made || ' entries created'), 'success');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
