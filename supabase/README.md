# Database (Supabase)

Project ref: `plutdajzefwtpgofpqlk`. backend-ts talks to it with the service role; the web app and driver app use the anon key plus the user's session, governed by row-level security.

## Current state

The production schema was edited by hand over time, so the files in `migrations/` before `20260928*` cannot rebuild it:
there is no baseline (the base tables live in `../scripts/supabase_init.sql`), several tables exist only in production
(`tpl_partners`, `tpl_corridors`, `tpl_documents`, `customers`) or only in loose scripts (`cargo_manifest`, `sos_alerts`,
`kyc_profiles`, `system_settings` under `../backend-ts/`), and some version numbers are reused.

The `20260928*` migrations are written to apply safely on top of production as it is today.

## 1. Apply the security migrations

Order matters. Take a backup first (Dashboard → Database → Backups, or `pg_dump`). Ideally, run the migrations on a Supabase branch first.

Before applying, list the current storage policies — the migration drops every policy that mentions `kyc_documents` or is not scoped to any bucket; anything else on `storage.objects` is left alone:
```sql
select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'storage';
```

1. Deploy the web app from this branch (it no longer reads `vendor_profiles.dummy2`/`kyc_profiles`, opens KYC documents through signed URLs, and uploads 3PL documents through backend-issued signed upload URLs).
2. In the SQL editor (or `supabase db push` once the baseline below is in place), run, in order:
   - `migrations/20260928000000_secure_user_roles.sql` — roles only from server-set `app_metadata`; clients cannot write `public.users` except `push_token`.
   - `migrations/20260928000100_vendor_kyc_columns.sql` — `vendor_profiles.kyc_status` / `kyc_data`, backfilled from `dummy2`. Rows whose `dummy2` is not valid JSON are listed as NOTICEs; review them by hand.
   - `migrations/20260928000200_row_level_security.sql` — drops every existing policy in `public`, enables RLS on every public table, and creates only the policies the clients need; makes the `kyc_documents` bucket private.
   - `migrations/20260928000300_status_alignment.sql` — enum/constraint values the code writes.
   - `migrations/20260928000400_unique_tpl_custom_id.sql` — 3PL partner IDs (which name their document folders) must be unique. If it prints duplicate NOTICEs, rename those partners' `custom_id` and run it again.
3. Deploy backend-ts.

## 1b. Follow-up migrations (`20260929*`)

Applied to the live project on 2026-09-29 (000000–000800, in order; checks below passed). 000600 adds columns the code already used (vehicles.cargo_types, vehicles.current_location_name, shipments.required_vehicle_type), 000700 restores own-row read/update on notifications, 000800 adds tpl_partners.phone. The project has no `supabase_migrations` history table yet, so step 4 of the CLI adoption below still has to stamp them.

Deploy backend-ts and the web app from the same branch **first** (the web app then reads vendor views through the backend), then run, in order:

- `migrations/20260929000000_vendor_vehicle_exposure.sql` — vendors no longer read `vehicles` rows. They see open windows and their own bids through `GET /capacity/windows/open` and `GET /capacity/bids/mine` (vehicle type, free capacity, origin city; the plate only on a bid they won). Staff and drivers keep their access.

- `migrations/20260929000100_vendor_kyc_reverification.sql` — an approved vendor that changes its company name, GST number, registered address or KYC form/documents (`kyc_data`) goes back to `submitted` with the review stamp cleared. Staff edits do not reset it. The backend applies the same rule on `POST /vendor/profile`.

- `migrations/20260929000300_tpl_rejection_reason.sql`, `20260929000400_vendor_company_logo.sql`, `20260929000500_rejection_reasons.sql` — additive columns: rejection reasons for 3PL partners, bids, vendor requests and KYC (`kyc_rejection_reason`, which only staff can write and which clears on approval or resubmission), and the vendor logo path.

- `migrations/20260929000200_tpl_signed_uploads.sql` — nobody inserts 3PL documents directly any more: drops the anonymous `tpl-applications/` upload policy and the 3PL partner-folder branch of `kyc_documents_upload_own` (vendors still upload into their own `<user id>/` folder). 3PL applicants and partners upload through `POST /tpl/applications/upload-url`, which checks the application, document type, format and size and returns a signed upload URL for a path the backend chooses. Also restricts the `kyc_documents` bucket to PDF, JPG and PNG (the only formats any uploader in the app offers), which binds signed uploads too.

These files re-apply safely. If `20260928000200` is ever re-run, re-run the `20260929*` files after it (it recreates the policies they replace).

Optional, recommended: set a per-file size limit on the bucket (Dashboard → Storage → `kyc_documents` → Edit bucket → Restrict file size). A signed upload URL cannot carry a size limit of its own, so the backend's check (`TPL_UPLOAD_MAX_BYTES`, default 2 MB) covers the declared size and the bucket limit covers the actual upload. Vendor KYC uploads share the bucket, so choose a value that suits them too.

Check:
```sql
-- vendors have no branch in the vehicles policy
select qual from pg_policies where schemaname = 'public' and tablename = 'vehicles' and policyname = 'vehicles_select';
-- expected storage policies: kyc_documents_read (SELECT), kyc_documents_upload_own (INSERT, authenticated)
select policyname, cmd, roles from pg_policies where schemaname = 'storage';
select allowed_mime_types from storage.buckets where id = 'kyc_documents';
```
4. Check:
   ```sql
   -- every public table has RLS on
   select tablename from pg_tables where schemaname = 'public' and not rowsecurity;
   -- no policy is open to everyone
   select tablename, policyname, roles, qual from pg_policies where schemaname = 'public' and qual = 'true';
   -- (expected: only system_settings_select)
   select public from storage.buckets where id = 'kyc_documents';  -- false
   -- accounts with elevated roles (confirm each one is legitimate)
   select id, email, role, created_at from public.users where role in ('superadmin', 'admin', 'manager');
   -- public views bypass RLS when owned by postgres; review any that exist
   select table_name from information_schema.views where table_schema = 'public';
   ```

The driver app still uses the service-role key until the Phase 3 release, so these policies do not affect it yet; they already include what the new driver app needs.

## 2. Make the schema reproducible (baseline)

Needs the Supabase CLI (`brew install supabase/tap/supabase`) and the database password.

```bash
supabase login
supabase link --project-ref plutdajzefwtpgofpqlk
supabase db dump --linked --schema public -f supabase/migrations/20260927000000_baseline.sql
```

Then, in one commit:

1. Move every migration older than the baseline (everything before `20260927000000`, and the unversioned `add_phone_to_users.sql`; not the `20260928*` files), plus `../scripts/supabase_init.sql`, `../backend-ts/kyc_migration.sql` and `../backend-ts/scripts/*.sql`, into `migrations/_archive/` (history only, never applied again).
2. The `storage` schema is managed by Supabase and is not dumped; the `kyc_documents` bucket policies live in `20260928000200_row_level_security.sql`.
3. Grep the baseline for `tpl_partners`, `customers`, `cargo_manifest`, `sos_alerts`, `system_settings`, `kyc_profiles` to confirm they were captured.
4. Mark the baseline and the `20260928*`/`20260929*` migrations that have been applied as applied: `supabase migration repair --status applied 20260927000000 20260928000000 20260928000100 20260928000200 20260928000300 20260928000400 20260929000000 20260929000100 20260929000200 20260929000300 20260929000400 20260929000500 20260929000600 20260929000700 20260929000800`.

The baseline is stamped just before the `20260928*` and `20260929*` files; those are idempotent, so on a fresh `supabase db reset` they re-apply cleanly on top of it (and add the storage policies, which the dump does not contain).

From then on every schema change is a new file from `supabase migration new <name>`, tested with `supabase db reset` locally before it is pushed.

## Follow-ups

- Once the new web app has been live for a while, drop `vendor_profiles.dummy2` and `kyc_profiles`.
- After the Phase 3 driver app release, rotate the service-role key (Dashboard → Settings → API) and update backend-ts and ml-service.
