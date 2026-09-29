-- ═══════════════════════════════════════════════════════════════════
-- RouteIQ — FULL DATABASE WIPE (Data Only, Schema Preserved)
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- WARNING: This deletes ALL data from ALL tables. NOT reversible.
-- ═══════════════════════════════════════════════════════════════════

-- Safe truncate: skips tables that don't exist
CREATE OR REPLACE FUNCTION safe_truncate(tbl text) RETURNS void AS $$
BEGIN
  EXECUTE format('TRUNCATE TABLE %s CASCADE', tbl);
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'Skipped % (does not exist)', tbl;
END;
$$ LANGUAGE plpgsql;

BEGIN;

-- ── Layer 1: Leaf / child tables ──────────────────────────────────
SELECT safe_truncate('public.gps_points');
SELECT safe_truncate('public.ai_agent_logs');
SELECT safe_truncate('public.telemetry');
SELECT safe_truncate('public.shipment_logs');
SELECT safe_truncate('public.route_stops');
SELECT safe_truncate('public.delivery_points');
SELECT safe_truncate('public.sos_alerts');
SELECT safe_truncate('public.notifications');
SELECT safe_truncate('public.driver_confirmations');

-- ── Layer 2: Financial tables ─────────────────────────────────────
SELECT safe_truncate('public.payments');
SELECT safe_truncate('public.invoices');
SELECT safe_truncate('public.booking_ledger_adjustments');
SELECT safe_truncate('public.booking_ledger');

-- ── Layer 3: Vendor & bidding tables ──────────────────────────────
SELECT safe_truncate('public.vendor_route_opportunities');
SELECT safe_truncate('public.vendor_shipment_requests');
SELECT safe_truncate('public.capacity_bids');
SELECT safe_truncate('public.capacity_windows');
SELECT safe_truncate('public.vendor_profiles');

-- ── Layer 4: Cargo & shipment tables ──────────────────────────────
SELECT safe_truncate('public.cargo_manifest');
SELECT safe_truncate('public.shipments');

-- ── Layer 5: Route & fleet tables ─────────────────────────────────
SELECT safe_truncate('public.routes');
SELECT safe_truncate('public.vehicles');
SELECT safe_truncate('public.depots');

-- ── Layer 6: 3PL & network tables ─────────────────────────────────
SELECT safe_truncate('public.tpl_partners');
SELECT safe_truncate('public.third_party_agreements');
SELECT safe_truncate('public.network_relationships');
SELECT safe_truncate('public.organizations');

-- ── Layer 7: Users (public + auth) ────────────────────────────────
SELECT safe_truncate('public.users');
DELETE FROM auth.users;

-- ── Cleanup helper function ───────────────────────────────────────
DROP FUNCTION safe_truncate(text);

-- ── Refresh PostgREST schema cache ────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- DONE. All data wiped. Schema, indexes, RLS policies intact.
-- ═══════════════════════════════════════════════════════════════════
