# Phase 1: organisations and data isolation

Implements the foundation of [platform-model.md](platform-model.md). Behaviour-preserving: today's data
moves into one logistic company, "MargixIndia Logistics", so every screen keeps working while the platform
becomes multi-company. Later phases build the separate dashboards on top.

## 1. New tables (migration `20261002010000_organizations.sql`)

| Table | Columns | Notes |
|---|---|---|
| `organizations` | `id uuid pk`, `kind org_kind` (`platform`, `logistic_company`, `vendor`, `tpl_partner`), `name`, `legal_name`, `gstin`, `pan`, `state`, `city`, `address`, `pincode`, `phone`, `email`, `status org_status` (`pending`, `active`, `suspended`, `rejected`, default `pending`), `profile jsonb default '{}'` (invoicing details, bank, logo, settings), `approved_by`, `approved_at`, `created_by`, `created_at`, `updated_at` | one row per business |
| `org_members` | `org_id`, `user_id` (→ `users.id`), `role org_role` (`owner`, `admin`, `ops`, `finance`, `dispatcher`, `driver`, `member`), `status` (`invited`, `active`, `removed`), `invited_by`, `created_at`; pk `(org_id, user_id)` | a person can belong to several organisations |
| `tpl_affiliations` | `company_id` (→ organizations, kind `logistic_company`), `tpl_id` (→ organizations, kind `tpl_partner`), `status` (`pending`, `active`, `paused`, `ended`), `requested_by`, `approved_by`, `approved_at`, `created_at`; pk `(company_id, tpl_id)` | a 3PL can join **several** companies; each company approves |

Platform admins are members of the one `platform` organisation (role `owner` or `admin`).

## 2. Ownership columns on existing tables

Two kinds of owner, so a vendor and a company can both see a shared order:

- `carrier_org_id` → the **logistic company** running it.
- `vendor_org_id` → the **vendor** it is for.

| Column | Tables |
|---|---|
| `carrier_org_id` | `vehicles`, `depots`, `routes`, `shipments`, `cargo_manifest`, `capacity_windows`, `cargo_exceptions`, `cargo_transfers`, `cargo_claims`, `driver_pay_entries`, `driver_pay_rates`, `driver_payouts`, `expenses`, `tpl_offers`, `tpl_orders`, `sos_alerts`, `maintenance_alerts`, `vehicle_maintenance_jobs` |
| `vendor_org_id` | `shipments`, `cargo_manifest`, `vendor_shipment_requests`, `capacity_bids`, `cargo_claims`, `customer_bookings` |
| `issuer_org_id`, `bill_to_org_id` | `invoices` (company issues, vendor is billed) |

Child tables (stops, delivery points, parcels, logs, telemetry, fuel logs, service records and so on)
follow their parent and get no column in Phase 1.

All the new columns are nullable `uuid` referencing `organizations(id)`, with an index each.

## 3. Backfill (same migration, idempotent)

1. Create the **platform** org "MargixIndia" (`active`) and the **logistic company** "MargixIndia
   Logistics" (`active`). Copy the company profile (name, GSTIN, state, address, bank) from
   `system_settings` into its `profile`/columns.
2. Store their ids in `system_settings`: `platform_org_id` and `default_company_org_id`.
3. Every existing row in the `carrier_org_id` tables → the default company; invoices → `issuer_org_id` =
   the default company.
4. Each `vendor_profiles` row becomes a **vendor** organisation (its company name, GSTIN, PAN, status
   `active` if KYC approved, else `pending`). Its user is `owner`. Set `vendor_org_id` on that vendor's
   requests, loads, bids, claims and invoices (`bill_to_org_id`).
5. Each `tpl_partners` row becomes a **tpl_partner** organisation, with an `active` affiliation to the
   default company when the partner is approved (else `pending`).
6. Memberships: `superadmin` → platform `owner` **and** company `owner`; `admin` → company `admin`;
   `manager` → company `ops`; `driver` → company `driver`; `vendor` → its vendor org `owner`.
   Customers stay as they are; they merge into vendors in Phase 3.

## 4. Safety nets so nothing breaks

- **Default owner.** A `BEFORE INSERT` trigger on each `carrier_org_id` table fills a null
  `carrier_org_id` with `default_company_org_id`, so code paths not yet updated (the scheduler, older
  services) still stamp the right owner.
- **Auto-membership.** A trigger on `public.users` insert adds staff and drivers to the default company,
  and gives a new `vendor` their own vendor organisation (`pending`). The sign-up flow keeps working.

## 5. Backend (`backend-ts`)

- `core/org-context.ts`: after authentication, load the user's active memberships (cached 60 s per user)
  and set `req.org` = the active organisation, picked by the `X-Org-Id` header, else the user's only
  one, else their first `logistic_company`, plus `req.orgRole`, `req.memberships`, `req.isPlatformAdmin`.
  An `X-Org-Id` the user isn't a member of gets **403**.
- **Writes** stamp `carrier_org_id` / `vendor_org_id` / `issuer_org_id` from `req.org`, or from the order
  being acted on, on every create path for the listed tables.
- **Reads, Phase 1 scope:** the main lists filter by the active company: vehicles, shipments, routes
  (trips), invoices, depots, cargo cases, people (members of the org), driver pay. A vendor's lists filter
  by `vendor_org_id`. Platform admins see all. The remaining endpoints are scoped in Phase 2. With one
  company, results are identical to today.
- **Endpoints:**
  - `GET /orgs/mine`: memberships, for the switcher.
  - `GET /org` and `PATCH /org`: the active org's profile (owner or admin).
  - `GET /org/members`, `POST /org/members` (invite an existing user by email or phone with a role),
    `PATCH /org/members/:userId` (role, status).
  - `POST /orgs`: register a new logistic company or vendor org (`pending`, the creator becomes `owner`).
  - Platform admin: `GET /admin/orgs` (filter by kind and status), `PUT /admin/orgs/:id/approve`,
    `/reject`, `/suspend`.
  - 3PL: `POST /tpl/affiliations` (a 3PL org asks to join a company), `GET /org/tpl-affiliations` (the
    company lists them), `PUT /org/tpl-affiliations/:tplId/approve|pause|end`.
  - All validated with zod and audited (`ai_agent_logs` / audit service).

## 6. Database security (RLS)

- `app.user_org_ids()` (SECURITY DEFINER, STABLE) returns the caller's active org ids;
  `app.is_platform_admin()` likewise.
- New tables: members read their own orgs and fellow members; owners and admins manage members;
  platform admins read and write all.
- For tables the web app reads directly through Supabase (realtime, a few direct selects), add an
  org-match condition to the existing staff policies:
  `carrier_org_id = ANY(app.user_org_ids()) OR vendor_org_id = ANY(app.user_org_ids()) OR app.is_platform_admin()`.
  Find them by grepping the frontend for direct `.from(` and `.channel(` use. Don't loosen any policy.

## 7. Web app (minimal in Phase 1)

- An organisation switcher in the header when a user has more than one membership. It sends `X-Org-Id`
  on every API call and remembers the choice per browser.
- The header shows the active organisation's name.

## 8. Done when

- CI is green, and the 75-step story is 75/75 on the GitHub runner. The story's seeded accounts get
  memberships through the triggers.
- New tests cover: org context selection and the 403 on a foreign `X-Org-Id`, write stamping, list
  scoping (two companies seeded, each sees only its own vehicles and shipments), member management
  permissions, 3PL affiliation with two companies, platform-admin approval, and the backfill rules
  (a SQL test in the runner).
- Migration dry-run, then applied on test by the deploy; live on release.
