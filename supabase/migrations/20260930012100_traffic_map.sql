-- Traffic on the maps: speeds up the incidents-in-a-viewport lookup.
--
-- GET /traffic/incidents?bbox=... asks for the open incidents whose position falls inside the map's
-- current view. traffic_incidents only had an index on (active, last_seen_at), so every pan of the
-- map scanned all open incidents. This partial index covers the open ones by position.
--
-- No new columns: the app needs nothing else from this migration. Idempotent and safe to re-run.
-- NOT YET APPLIED to the live project.

CREATE INDEX IF NOT EXISTS traffic_incidents_active_pos_idx
  ON public.traffic_incidents (lat, lng)
  WHERE active;
