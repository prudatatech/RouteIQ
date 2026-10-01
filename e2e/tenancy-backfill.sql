-- The backfill rules of 20261002010000_organizations.sql, checked on a throwaway transaction (rolled back at the end).
-- Starts from a database with data and no organisations (what "test" looks like when the migration lands), runs
-- app.backfill_organizations() and checks the rules of docs/tenancy-design.md §3; then runs it again to check it is idempotent.
-- Run as the database owner: docker exec -i supabase_db_margix-e2e psql -U postgres -v ON_ERROR_STOP=1 -f - < e2e/tenancy-backfill.sql
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.expect(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'BACKFILL CHECK FAILED: %', what; END IF; RAISE NOTICE 'ok: %', what; END $$;

-- Legacy state: no organisations, and the sign-up triggers off so the rows below look like data from before them
DELETE FROM public.org_members;
DELETE FROM public.tpl_affiliations;
DELETE FROM public.organizations;
DELETE FROM public.system_settings WHERE key IN ('platform_org_id', 'default_company_org_id', 'company_profile');
ALTER TABLE public.users DISABLE TRIGGER trg_user_membership_insert;
ALTER TABLE public.vendor_profiles DISABLE TRIGGER trg_vendor_profile_org;
ALTER TABLE public.tpl_partners DISABLE TRIGGER trg_tpl_partner_org;

INSERT INTO public.system_settings (key, value) VALUES
  ('company_profile', '{"value": {"legal_name": "Margix Logistics Pvt Ltd", "gstin": "27AAPFU0939F1ZV", "state": "Maharashtra", "address": "Plot 4, Bhiwandi", "bank_name": "HDFC Bank", "bank_account_no": "50200012345678"}}');

-- Sign-in accounts for everyone (the foreign keys point at auth.users); the sign-up trigger stays out of the way
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-000000000001', 'su@t.test'), ('00000000-0000-4000-8000-000000000002', 'ad@t.test'),
  ('00000000-0000-4000-8000-000000000003', 'mg@t.test'), ('00000000-0000-4000-8000-000000000004', 'dr@t.test'),
  ('00000000-0000-4000-8000-0000000000a1', 'va@t.test'), ('00000000-0000-4000-8000-0000000000b1', 'vb@t.test'),
  ('00000000-0000-4000-8000-0000000000c1', 'tp@t.test'), ('00000000-0000-4000-8000-000000000005', 'nd@t.test'),
  ('00000000-0000-4000-8000-0000000000a2', 'nv@t.test');

INSERT INTO public.users (id, full_name, role, email) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Sue Super', 'superadmin', 'su@t.test'),
  ('00000000-0000-4000-8000-000000000002', 'Asha Admin', 'admin', 'ad@t.test'),
  ('00000000-0000-4000-8000-000000000003', 'Manoj Manager', 'manager', 'mg@t.test'),
  ('00000000-0000-4000-8000-000000000004', 'Ravi Driver', 'driver', 'dr@t.test'),
  ('00000000-0000-4000-8000-0000000000a1', 'Vik Approved', 'vendor', 'va@t.test'),
  ('00000000-0000-4000-8000-0000000000b1', 'Vik Pending', 'vendor', 'vb@t.test'),
  ('00000000-0000-4000-8000-0000000000c1', 'Tina Tpl', 'vendor', 'tp@t.test');
INSERT INTO public.vendor_profiles (id, company_name, gst_number, city, latitude, longitude, kyc_status) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'Acme Traders', '07AAACR5055K1Z7', 'Delhi', 28.5, 77.2, 'approved'),
  ('00000000-0000-4000-8000-0000000000b1', 'Basic Goods', '27AAPFU0939F1ZV', 'Pune', 18.5, 73.8, 'submitted');
INSERT INTO public.tpl_partners (id, user_id, company_name, pan_number, gstin, status) VALUES
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c1', 'Tiny Transport', 'AAAPA1234A', '27AAPFU0939F1ZV', 'active'),
  ('00000000-0000-4000-8000-0000000000d2', NULL, 'Waiting Carriers', 'AAAPB1234B', '27AAPFU0939F1ZV', 'pending');

INSERT INTO public.vehicles (id, plate_number) VALUES ('00000000-0000-4000-8000-0000000000e1', 'MH01TEST01');
INSERT INTO public.depots (id, name, address, latitude, longitude) VALUES ('00000000-0000-4000-8000-0000000000e2', 'Hub', 'Pune', 18.5, 73.8);
INSERT INTO public.vendor_shipment_requests (id, vendor_id, pickup_location, pickup_lat, pickup_lng, drop_location, drop_lat, drop_lng, required_capacity_kg)
  VALUES ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a1', 'A', 1, 1, 'B', 2, 2, 100);
INSERT INTO public.cargo_manifest (id, vendor_request_id) VALUES ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f1');
INSERT INTO public.invoices (id, invoice_number, vendor_id) VALUES ('00000000-0000-4000-8000-0000000000f3', 'INV-T-0001', '00000000-0000-4000-8000-0000000000a1');

SELECT app.backfill_organizations();

-- 1-2. The platform and the company exist, are active, and are recorded in system_settings
SELECT pg_temp.expect((SELECT count(*) FROM public.organizations WHERE kind = 'platform' AND name = 'MargixIndia' AND status = 'active') = 1, 'one active platform organisation');
SELECT pg_temp.expect((SELECT count(*) FROM public.organizations WHERE kind = 'logistic_company' AND name = 'MargixIndia Logistics' AND status = 'active') = 1, 'one active company "MargixIndia Logistics"');
SELECT pg_temp.expect(app.platform_org_id() = (SELECT id FROM public.organizations WHERE kind = 'platform'), 'platform_org_id is stored');
SELECT pg_temp.expect(app.default_company_org_id() = (SELECT id FROM public.organizations WHERE kind = 'logistic_company'), 'default_company_org_id is stored');
-- the company profile is copied
SELECT pg_temp.expect((SELECT gstin = '27AAPFU0939F1ZV' AND state = 'Maharashtra' AND legal_name = 'Margix Logistics Pvt Ltd' AND profile ->> 'bank_name' = 'HDFC Bank'
                       FROM public.organizations WHERE id = app.default_company_org_id()), 'the company takes its name, GSTIN, state and bank from company_profile');

-- 3. Everything that runs the logistics, and every invoice, belongs to the company
SELECT pg_temp.expect((SELECT carrier_org_id = app.default_company_org_id() FROM public.vehicles), 'vehicles go to the company');
SELECT pg_temp.expect((SELECT carrier_org_id = app.default_company_org_id() FROM public.depots), 'depots go to the company');
SELECT pg_temp.expect((SELECT carrier_org_id = app.default_company_org_id() FROM public.cargo_manifest), 'loads go to the company');
SELECT pg_temp.expect((SELECT issuer_org_id = app.default_company_org_id() FROM public.invoices), 'invoices are issued by the company');

-- 4. Each vendor profile becomes a vendor organisation: active when KYC is approved, else pending; its user is the owner
SELECT pg_temp.expect((SELECT count(*) FROM public.organizations WHERE kind = 'vendor') = 2, 'one vendor organisation per profile');
SELECT pg_temp.expect((SELECT status = 'active' AND name = 'Acme Traders' AND gstin = '07AAACR5055K1Z7' FROM public.organizations WHERE kind = 'vendor' AND profile ->> 'legacy_user_id' = '00000000-0000-4000-8000-0000000000a1'), 'approved vendor: active, with its name and GSTIN');
SELECT pg_temp.expect((SELECT status = 'pending' FROM public.organizations WHERE kind = 'vendor' AND profile ->> 'legacy_user_id' = '00000000-0000-4000-8000-0000000000b1'), 'vendor not yet approved: pending');
SELECT pg_temp.expect((SELECT count(*) FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id
                       WHERE o.kind = 'vendor' AND m.role = 'owner' AND m.user_id::text = o.profile ->> 'legacy_user_id') = 2, 'each vendor user owns their organisation');
SELECT pg_temp.expect((SELECT vendor_org_id = app.vendor_org_of('00000000-0000-4000-8000-0000000000a1') FROM public.vendor_shipment_requests), 'the vendor\'s request carries its organisation');
SELECT pg_temp.expect((SELECT vendor_org_id = app.vendor_org_of('00000000-0000-4000-8000-0000000000a1') FROM public.cargo_manifest), 'the load of that request carries it too');
SELECT pg_temp.expect((SELECT bill_to_org_id = app.vendor_org_of('00000000-0000-4000-8000-0000000000a1') FROM public.invoices), 'the invoice is billed to the vendor organisation');

-- 5. Each 3PL partner becomes an organisation; approved -> active with an active affiliation, else pending
SELECT pg_temp.expect((SELECT count(*) FROM public.organizations WHERE kind = 'tpl_partner') = 2, 'one 3PL organisation per partner');
SELECT pg_temp.expect((SELECT a.status = 'active' FROM public.tpl_affiliations a JOIN public.organizations o ON o.id = a.tpl_id WHERE o.name = 'Tiny Transport' AND a.company_id = app.default_company_org_id()), 'approved partner: active affiliation to the company');
SELECT pg_temp.expect((SELECT a.status = 'pending' FROM public.tpl_affiliations a JOIN public.organizations o ON o.id = a.tpl_id WHERE o.name = 'Waiting Carriers'), 'pending partner: pending affiliation');
SELECT pg_temp.expect((SELECT status = 'active' FROM public.organizations WHERE name = 'Tiny Transport') AND (SELECT status = 'pending' FROM public.organizations WHERE name = 'Waiting Carriers'), '3PL organisation status follows the partner');
SELECT pg_temp.expect((SELECT m.role = 'owner' FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id WHERE o.name = 'Tiny Transport'), 'the partner\'s user owns the 3PL organisation');

-- 6. Memberships by role
SELECT pg_temp.expect((SELECT count(*) FROM public.org_members WHERE user_id = '00000000-0000-4000-8000-000000000001' AND role = 'owner'
                         AND org_id IN (app.platform_org_id(), app.default_company_org_id())) = 2, 'superadmin: owner of the platform and of the company');
SELECT pg_temp.expect((SELECT role = 'admin' FROM public.org_members WHERE user_id = '00000000-0000-4000-8000-000000000002' AND org_id = app.default_company_org_id()), 'admin: company admin');
SELECT pg_temp.expect((SELECT role = 'ops' FROM public.org_members WHERE user_id = '00000000-0000-4000-8000-000000000003' AND org_id = app.default_company_org_id()), 'manager: company ops');
SELECT pg_temp.expect((SELECT role = 'driver' FROM public.org_members WHERE user_id = '00000000-0000-4000-8000-000000000004' AND org_id = app.default_company_org_id()), 'driver: company driver');
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM public.org_members WHERE user_id = '00000000-0000-4000-8000-000000000002' AND org_id = app.platform_org_id()), 'only a superadmin is in the platform');
SELECT pg_temp.expect(app.is_platform_admin() = false, 'no caller, no platform admin');

-- Idempotent: a second run changes nothing
CREATE TEMP TABLE before_counts AS SELECT
  (SELECT count(*) FROM public.organizations) AS orgs, (SELECT count(*) FROM public.org_members) AS members, (SELECT count(*) FROM public.tpl_affiliations) AS affs;
SELECT app.backfill_organizations();
SELECT pg_temp.expect((SELECT orgs = (SELECT count(*) FROM public.organizations) AND members = (SELECT count(*) FROM public.org_members) AND affs = (SELECT count(*) FROM public.tpl_affiliations) FROM before_counts), 'running the backfill again adds nothing');

-- The triggers, back on: a new driver joins the company; a new vendor gets a pending organisation; a null carrier is filled
ALTER TABLE public.users ENABLE TRIGGER trg_user_membership_insert;
INSERT INTO public.users (id, full_name, role) VALUES ('00000000-0000-4000-8000-000000000005', 'New Driver', 'driver'), ('00000000-0000-4000-8000-0000000000a2', 'New Vendor', 'vendor');
SELECT pg_temp.expect(EXISTS (SELECT 1 FROM public.org_members WHERE user_id = '00000000-0000-4000-8000-000000000005' AND role = 'driver' AND org_id = app.default_company_org_id()), 'a new driver joins the company');
SELECT pg_temp.expect((SELECT o.status = 'pending' AND o.kind = 'vendor' FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id WHERE m.user_id = '00000000-0000-4000-8000-0000000000a2'), 'a new vendor gets their own pending organisation');
INSERT INTO public.vehicles (id, plate_number) VALUES ('00000000-0000-4000-8000-0000000000e9', 'MH01TEST09');
SELECT pg_temp.expect((SELECT carrier_org_id = app.default_company_org_id() FROM public.vehicles WHERE plate_number = 'MH01TEST09'), 'a vehicle inserted without an owner gets the default company');

ROLLBACK;
