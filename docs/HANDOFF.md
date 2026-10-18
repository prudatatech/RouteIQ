# Handoff: where MargixIndia stands (3 Oct 2026)

For a new session or agent. Rules and workflow are in `CLAUDE.md` (read it first). This file is the state of the
product, the environment, decisions already taken, and what is open. Keep it current when something changes.

## 1. The product
MargixIndia is a multi-tenant logistics SaaS (source of truth: `docs/platform-model.md`).
- **Vendor**: a business that ships goods. Posts loads, tracks, pays. Explores without signing in; signs in only
  to commit (`docs/vendor-public.md`).
- **Logistic company**: the tenant. Owns fleet, drivers, documents; takes vendor loads; invoices the vendor with
  its own GSTIN.
- **3PL partner**: small fleet owner working under one or more companies (affiliations), with its own vehicles,
  drivers, GPS and real POD (`docs/network-design.md`).
- **Platform admin** (the owner): organisations, vendor KYC review, 3PL approval, config. Revenue model:
  commission per completed order (not built yet: phase N3).
- Roadmap (approved): N1 anchor network (DONE, live) -> N2 matching intelligence -> N3 commission -> N4 Shipper OS
  light (orders, warehouses, API keys, webhooks) -> N5 control towers. Full plan:
  `~/.claude/plans/mellow-fluttering-unicorn.md` (summary in memory `network-blueprint`).

## 2. Environment
Everything runs on Azure, resource group `margix-rg` (Central India), one Container Apps environment `margix-env`,
registry `margixacr7m52h4t5it6og`.

| | test (branch `test`) | live (branch `main`) |
|---|---|---|
| Web | https://staging.margixindia.com | https://portal.margixindia.com |
| API | https://staging-api.margixindia.com/api/v1 | https://api.margixindia.com/api/v1 |
| Data (auth/rest/storage gateway) | https://staging-data.margixindia.com | https://data.margixindia.com |
| Container apps | `margix-test-*` | `margix-*` |
| Postgres Flexible Server | `margix-test-pg` (B1ms) | `margix-pg` (B1ms) |

- Self-hosted Supabase-style platform per stage (`infra/platform.bicep`, `infra/platform.sh`): gateway (Kong),
  auth (GoTrue), rest (PostgREST), rt (Realtime), storage (storage-api) + s3proxy to Azure Blob.
- API: `backend-ts` (Express/TS). Web: `frontend` (React/Vite). Also `ml-service`, `driver-app`, `customer-app`.
- Test keeps gateway/auth/rest/api warm (min 1 replica); rt/storage/s3proxy sleep, so the first upload on test can
  take ~25 s.
- Secrets (gitignored, never print): `infra/secrets.test.env`, `infra/secrets.live.env` (API secrets, applied with
  `./infra/set-secrets.sh --stage test|live`), `infra/platform.test.env`, `infra/platform.live.env` (platform keys:
  ANON_KEY, SERVICE_ROLE_KEY, ...), `infra/azure.local.env`. Copies exist in the main checkout and in
  `.claude/worktrees/integration`.
- Deploy: push to `test` -> `Deploy to Azure` deploys the test stage (migrate job first); merge to `main` deploys
  live. Images are tagged by directory tree hash and reused from the registry, so a release takes ~90 s.
- CI: `margixindia CI` on every push (backend-ts, frontend, ml-service, mobile apps). Story: `uat.yml`
  (manual dispatch, 91 steps on a throwaway database on the GitHub runner).
- Email: Resend (domain `margixindia.com` verified). Sender `EMAIL_FROM` = `MargixIndia <no-reply@margixindia.com>`.
  Key set on TEST only.

## 3. Decisions already taken (do not reopen without the owner)
- Requests opens on New loads and keeps pending vendor rows visible there when the company board is unavailable
  in the active organisation context. Active company staff use the company board; All remains aggregate history.
- The company load board and quote drawer wait for organisation context and request `/company/loads/market`
  only for active logistic company staff. Platform/vendor/3PL contexts show a company-selection message instead
  of making forbidden requests. Market caches include the acting organisation; switching companies reloads rows.
- All instant price recommendations (vendor, company, shipment/return-trip and customer/mobile quotes) now use the owner's five provisional per-km bands (LCV 15–25, 6-wheeler 20–30,
  10-wheeler 25–40, multi-axle 35–55, container 50–80 rupees). The price modal explains distance × rate and the
  midpoint; posted ranges and signed-in quotes use one server calculation. Company acceptance passes the load's selected truck class, and company price screens show the shared explanation modal. See `docs/vendor-price-recommendation.md` for capacity,
  part-load and specialised-truck limits. This is separate from negotiated company pricing configuration.
- Vendor entry is **Post a load**. The owner requested removal of the duplicate Find a truck flow: its page,
  navigation, query seeding and standalone `/public/quote` endpoint are removed. Old `/ship` bookmarks redirect
  to `/vendor/request`. Return trips retain spare-space browsing and bidding; load estimates use `/public/loads/assist`.
  The mobile booking button says Cargo and weight (with existing translations); its booking flow is separate.
- Freight GST is the company's GTA option (`rcm_5` default, `fcm_5`, `fcm_18`), never the goods' HSN rate.
  Same-day pickup allowed with a warning. (`docs/gst-rates.md`)
- Vendor KYC review and 3PL approval are platform-only. A company sees its own partners without bank/PAN/documents.
- Onboarding now supports flagging one specific document instead of rejecting the whole application, on every
  flow: vehicle registration (`vehicles.document_issues`, `VehicleRequestsPage.tsx`), vendor KYC
  (`vendor_profiles.kyc_document_issues`, `VendorReviewPage.tsx` "Flag documents"), and logistic-company
  registration (`organizations.kyc_documents`/`kyc_document_issues`/`kyc_submitted_at`, self-service at
  `/company/kyc`, staff review in `OrganisationsPage.tsx`'s drawer). A logistic company now also needs GSTIN, PAN,
  bank details and five documents (GST registration, PAN, company registration/MSME cert, cancelled cheque,
  address proof) before the platform can approve it (`decideOrg` refuses approval of a pending company that has
  not called `/org/kyc/submit`); a rejected company resubmits on the same record instead of registering again.
  Activating a driver or staff member likewise asks for confirmation first if a required document is still
  missing (`people.service.ts` `changeStatus`, `confirm_missing_documents`). `FlagDocumentsModal.tsx` and
  `DocUploadField.tsx` are shared across all of these instead of duplicated per flow.
- 3PL partner applications now have the same per-document flagging (`tpl_partners.document_issues`, keyed by the
  doc_type strings already on `tpl_documents`: "PAN Card", "GST Certificate", "Cancelled Cheque", "Signed Rate
  Agreement"; `tplService.flagDocuments`, `PUT /tpl/:id/flag-documents`, "Flag documents" on
  `TplPartnerDetailPage.tsx`). A rejected application used to be a dead end (only "Apply again" - a brand new
  application); `updateApplication` now also accepts a rejected one, flipping it back to pending and clearing the
  reason and every flag. The applicant's tracking page (`TplTrackApplicationPage.tsx`) can now replace a flagged
  (or any, once resubmitting) document inline, through the existing PAN-verified edit API, rather than only via
  the full onboarding wizard. Found and removed a pre-existing dead end while building this: the tracking page's
  "Edit application details" button sent the applicant to `TplOnboardingPage.tsx?edit=<id>&pan=...`, but that
  wizard never reads `edit`/`pan` or prefills anything - it only ever files a brand new application. Still open:
  teaching the wizard to load and resubmit an existing application (for non-document fields) instead of only
  filing a new one; for now the tracking page covers documents only.
- A fresh audit of all four onboarding flows (owner asked to "check each step... find the significant gap")
  found and fixed real dead ends/holes: 3PL's rejected-applicant document-fix path was itself broken (the
  upload-url route still only allowed `status='pending'`); 3PL's quick-onboard form (`fleet_size` set) could
  reach `approve()` with no PAN, GSTIN, bank details or documents at all - `approve()` now refuses a first-time
  approval missing any of those; vendor KYC could get permanently stuck in `info_requested` once every flagged
  document was fixed through a per-document save rather than the full wizard (no code path ever moved it back
  to `submitted`) - fixed in `saveKycDocuments`; `CompanyKycPage.tsx`'s submit had no pre-submit validation for
  GSTIN/PAN/bank; a driver whose vehicle document was flagged saw nothing on the waiting screen they actually
  land on; the platform's company-review drawer collected bank details but never showed them to the reviewer;
  the 3PL reviewer page never showed the applicant's phone; the vendor reviewer page never showed the pickup
  location or declaration-accepted flag the vendor had to provide to submit.
  Still open, logged rather than built without the owner's steer (each is a product decision, not a bug):
  vehicle registration never asks for document expiry dates or container dimensions even though the backend
  schema and staff review screen are already built to show them (`driver-app` has no date-picker pattern yet,
  and no simulator access here to verify a new one); none of the four flows collect an entity/business type
  (proprietorship/LLP/Pvt Ltd), a CIN, an authorized signatory, or a registered-office-vs-operating-address
  distinction - a real compliance gap for a B2B GST-registered counterparty, but adding required fields to four
  live onboarding forms at once needs a deliberate scope decision, not a silent addition; the 3PL quick-onboard
  form's "Contact person" field is stored as the company's legal name with no separate field for the real one.
- One sign-in page `/login` for every account kind; each goes to its own area. The platform owner lands on
  `/platform/organisations`.
- Vendor review is a full page `/admin/kyc/:id`: approve, reject, ask for more details (status `info_requested`;
  the vendor answers on their Company page).
- Post a Load (`docs/load-posting-v2.md`): four steps, Pickup & delivery / Goods / Truck & price / Review. No
  address line (from the search pick), no site details, no delivery date; priority High/Medium/Low; HSN and GST
  editable; vehicle recommended or chosen from a list.
- Pricing: vendors do not choose quotes, budget or companies. The server computes a recommended freight range
  (`price_min_inr`/`price_max_inr`); a logistic company books at any amount inside it. Every load is open to all
  companies on the lane; high priority notifies the biggest networks first (own + affiliated 3PL vehicles). N2
  replaces this scorer with carrier scores. (`docs/order-routing.md`)
- Realtime change feeds cannot run on Azure Postgres (needs a superuser-only setting); the web polls instead.
- Cost audit (17 Oct 2026): the live Postgres Flexible Server (`margix-pg`) was ~42% of the resource group's
  monthly Azure bill on its own - almost entirely Burstable B2s compute hours (99% of that line item; storage/IOPS
  were trivial), not a storage or backup problem. 14-day metrics showed 5% avg CPU, 35% avg memory, ~23 avg
  connections - well within `Standard_B1MS` (the same SKU the test server already runs on). Resized `margix-pg`
  from B2s to B1ms (owner ran it; brief restart, verified healthy after with a live `/health` call and a real
  PostgREST query against the resized server) - expected to cut that line item by roughly 75%. Reserved/savings-plan
  pricing is not available for the Burstable tier at all (checked Azure's retail pricing API directly), so
  right-sizing was the only lever. Also found and deleted an orphaned third Postgres server
  (`margix-pg-922026946`, B1ms/PG16, zero connections for 7+ days, not referenced by any app or IaC file) - almost
  certainly a leftover from a past major-version upgrade that never got cleaned up. If performance regresses on
  B1ms under real traffic, the fix is `az postgres flexible-server update -g margix-rg -n margix-pg --sku-name
  Standard_B2s --tier Burstable` (same brief-restart trade-off in reverse).
- Staff can now enter a vendor KYC, a logistic company registration, or a 3PL application on behalf of someone who
  phoned or WhatsApp'd their details in instead of using self-serve - some applicants can't use the forms
  themselves. Each path goes through the exact same review queue as a self-serve submission, no auto-approval:
  - **Vendor**: superadmin-only `POST /vendor/admin/kyc/applicants` (resolve/invite the applicant's account by
    email) -> `POST /vendor/admin/kyc/applicants/:vendorUserId/upload-url` (documents, scoped to the applicant's id,
    not the caller's) -> `POST /vendor/admin/kyc/applicants/create` (same shape as self-serve `/vendor/kyc/submit`,
    reuses `submitKyc`/`assertKycContent` so validation is identical). UI: `EnterVendorKycPage.tsx`
    (`/admin/kyc/enter-on-behalf`, linked from `KycReviewPage.tsx`).
  - **Logistic company**: platform-admin-only `POST /admin/orgs/create-on-behalf` (invites the applicant as owner,
    leaves the company `pending`, not yet KYC-submitted) -> the same `updateOrg`/`createOrgKycUploadUrl`/
    `saveOrgDocuments`/`submitOrgKyc` functions self-service uses, just reached without the `org_members` ownership
    check (`adminOrgsRouter`'s `PATCH /:id`, `/:id/kyc/upload-url`, `/:id/kyc/documents`, `/:id/kyc/submit`). The
    route's top-level `email` is reserved for the applicant being invited, so the company's own `email` field is
    set afterward via `PATCH`. UI: `RegisterCompanyModal.tsx`, opened from `OrganisationsPage.tsx`.
  - **3PL**: already worked architecturally - `tpl.service.ts`'s `approve()` already branched on "no `user_id` yet
    (e.g. staff-created)" to send a password-setup link instead of a sign-in notice, since a 3PL application never
    required a pre-existing account either way. Added only `POST /tpl/admin/create` (superadmin-only, tags
    `created_by`; same body as public `/tpl/onboard`, always the full/non-quick form - never `fleetSize` or
    `user_id`). UI: `StaffCreateApplicationDrawer.tsx`, opened from `PartnersTab.tsx`.
  - **Drivers** already had this (`people.service.ts`'s invite flow) - no change needed.
  - `organizations.created_by` already existed; the same column was added to `vendor_profiles` and `tpl_partners`
    so every review screen can show a consistent "entered by staff" signal.
  - **Bug found and fixed same day**: all three staff-create flows let an application go out with zero documents
    (documents are optional at creation on purpose - staff may not have them yet), but none of the three
    review/detail pages could add a document afterward - once stuck, approval correctly 409s with
    "missing: documents" but there was no way back in. Fixed on all three, reusing backend routes already built
    for this (no new backend code for vendor/3PL; one new thin route for company):
    `TplPartnerDetailPage.tsx` gained an upload control (careful detail: the PATCH that attaches a document is a
    desired-final-list call, so it must resend every existing document too, or it deletes them);
    `VendorReviewPage.tsx` gained one (new route `PUT /vendor/admin/kyc/applicants/:vendorUserId/documents`,
    thin wrapper over the already-generic `saveKycDocuments`); `RegisterCompanyModal.tsx` can now be reopened in a
    "resume" mode for an existing not-yet-submitted company (a "Finish registration" button in `OrganisationsPage.tsx`'s
    `OrgDrawer`), since that modal creates the org before documents, so closing early stranded it the same way.
- UI/UX pass (owner asked to improve the landing page and "all other screens"; scoped to four buckets, all shipped):
  - **Landing page**: added a factual "How it works" 3-step section (post a load -> a company books it at the
    recommended price -> track to delivery) before the audience picker, so a first-time visitor understands the one
    real flow before choosing which of the four cards is them. No fabricated claims (testimonials/pricing/logos were
    deliberately not added - this app has none of that to show truthfully, and inventing it would violate the no-
    mock-data rule).
  - **Nav/IA**: the eleven-section menu (`config/navigation.ts`) is now nine - Shipments folded into Dispatch as a
    child link, Reports folded into Money the same way; neither page moved, only where the menu points changed.
    Also renamed Dispatch's "Optimize"/"Plan a trip" to "Auto-assign trips"/"Plan a trip by hand" so the automatic
    and manual planning tools read as different things at a glance.
  - **Onboarding**: `CompanyKycPage.tsx` (self-serve logistic-company KYC) now shows the same `Stepper` vendor/3PL
    onboarding already had - it was a flat form with no stage concept, so the three stages were named from its own
    existing section headings (Company details / Bank details / Documents); nothing about validation or field order
    changed.
  - **Dashboards**: fixed three concrete issues an audit found (not cosmetic guesses - grounded in the actual
    conditional-rendering code): `TodayPage.tsx`'s subtitle promises "most urgent first" but the Fleet-attention
    card sat second-to-last on the page, below stats/queues/Direct Load Allocation - moved up, and five queries
    (vehicles, fleetAlarms, insights, peopleAttention, driverActions) that had NO loading or error UI (a slow or
    failed fetch looked exactly like "nothing to show") now get real skeletons and `ErrorState`+retry.
    `VendorLoadsPage.tsx` hid its search box until more than 6 loads, unlike Fleet/Trips which always show it - now
    always shown. The 3PL portal's orders tab (`TplOrdersTab.tsx`) showed one combined error screen if EITHER its
    offers or orders query failed, hiding whichever one actually succeeded - now each section has its own
    error+retry, independent of the other.

## 4. Azure pitfalls (each broke something once)
- PostgREST (`margix-rest` / `margix-test-rest`) caches the database schema at startup and never notices a
  migration's new table or column on its own: any request touching the new column fails with "Could not find the
  '&lt;column&gt;' column ... in the schema cache". Hit live on 17 Oct 2026 - `POST /tpl/onboard` 500ing in production
  because `authorized_signatory_name` (added by an entity-type migration days earlier) was invisible to a REST
  container that hadn't restarted since Oct 1-2, so roughly two weeks of migrations were silently invisible to it
  until restarted by hand. A plain `az containerapp revision restart` does **not** recreate the running replica for
  this app; `az containerapp revision deactivate` then `activate` on the active revision does, and is now the last
  step of the `migrate` job's `reload-rest-schema` job in `deploy-azure.yml`, run automatically whenever a
  migration actually applied something. If this error ever recurs regardless, the manual fix is that
  deactivate/activate pair against `margix-rest` (live) or `margix-test-rest` (test).
- Staging was reset on 4 Oct at the owner's request: operational test records cleared; six existing demo accounts
  retained (platform owner, company admin, manager, driver, vendor, 3PL). All six password logins were verified.
  Organisations/configuration and reference catalogues remain; credentials were delivered separately, never committed.
- Performance investigation and measurements: `docs/performance-2026-10-04.md`. Shipment counts now use one
  backend-only grouped SQL call; notification bodies load on opening the bell; account restores share in-flight
  requests; map polls cannot overlap and pause in hidden tabs. SQL profiling is enabled on test without a restart.
- Staging notification history reached ~2.8 million rows; type-filtered queries scanned tens of thousands of
  unrelated rows per recipient and exhausted the REST pool (`PGRST003`, API 503). Migration
  `20261011120000_notification_query_indexes.sql` adds recipient/type/date and covering unread indexes.
  Duplicate-notification checks now stop on database errors instead of inserting after a failed check.
- Uploads go to Azure Blob through s3proxy (`JCLOUDS_AZUREBLOB_AUTH=azureKey`); signed links last 900 s.
- `platform.sh` re-binds the data domain's TLS every run (a redeploy once dropped it and broke sign-in).
- Tables created by the admin login lack grants: `db-migrate.sh` hands stray tables to app_owner.
- PostgREST: jsonb `.contains` needs `JSON.stringify`; on a `json` column filter with
  `.filter('col->>key','eq',v)`; ambiguous embeds must name the foreign key; chunk long IN lists (`selectIn`).
- The API caches a person's organisations for 60 s: call `invalidateOrgContext` after membership/KYC changes.
- GitHub's Azure login (OIDC) occasionally fails to fetch a token: re-run the job.

## 5. Open items (ask the owner before starting new phases)
- Owner choices pending: put the Resend key on live; restore "Need unloading help" on delivery?; company board
  order within the same priority and date (newest first now, or longest-waiting first).
- Owner configuration still missing: Twilio + Redis (SMS OTP), WhatsApp, TomTom key (route optimisation returns
  502; traffic calls get 401), telematics webhook secret, negotiated company per-km rate card, CA review of GST 2.0 rates (507 rows
  flagged needs_review).
- Product gaps: a real finance/dispatcher/ops split is the only one left open - see `docs/finance-role-options.md`
  for what each currently does and the options; owner is discussing with the team before deciding.
  Since fixed (17 Oct 2026): `/public/companies`' 200-row scan ran alphabetically BEFORE the city/vehicle_type
  filter, so a company sorting late could be invisible to a real search even if it was the only match - the
  filter now runs in the query itself, before the row cap, not after. `/finance/invoices` and `/finance/expenses`
  were genuinely unbounded (the `reports=open` invoices view skipped its date filter entirely, expenses had no
  limit at all) - both now use the same `{items, total, limit, offset}` envelope and server pagination as
  `/admin/orgs`; expenses' "Total" stat still sums the whole filtered range (a second, narrow amount-only query),
  not just the visible page, except while the client-side search box is active, where it's honestly relabelled
  "Total shown" since that filter never reaches the server. Vendor company details being "asked three times" was
  mostly already pre-filled correctly (company name/GSTIN/address) - the real gap was city/state/pincode, typed
  once at business-profile time then silently discarded; now mirrored into the vendor's KYC draft (merged, never
  overwriting anything the vendor already typed differently) so the KYC form picks them up without asking again.
  (Checked 17 Oct 2026, scoped deliberately rather than built: "no consignee GSTIN on loads" is not a clean,
  standalone field addition - the `shipments`/dispatch side already fully has `consignee_name`/`consignee_gstin`/
  `eway_bill_ref` (migration `20260930014100_cargo_lots.sql`, validated in `schemas/index.ts`'s `DropInputSchema`/
  `ShipmentCreateSchema`). The actual gap is in vendor load-posting (`LoadDraftSchema`), which has no consignee
  concept at all - only an unnamed "delivery contact" name/phone. Adding GSTIN there means first introducing a
  consignee entity to load posting with no automated consumer yet (no e-way-bill generation exists anywhere in
  this codebase, only a GSTIN *validator* in `gstin.service.ts` and unused GSP env vars) - exactly the kind of
  half-finished addition the engineering standard warns against. Needs a product decision (introduce the
  consignee concept now and leave it unconsumed, or scope it together with real e-way-bill generation) before
  it's built, not a quiet field add.)
  (Checked 17 Oct 2026: `/capacity/nearby-vendors` "lists all vendors to any company" is NOT a tenant-isolation
  bug - vendors aren't company-scoped by design (`docs/platform-model.md`: any company can solicit bids from any
  approved vendor), and only name/city/coordinates are returned, already pared down with a comment explaining why.
  The real gap was performance - it fetched every approved vendor nationwide before filtering by radius in memory.
  Fixed: a lat/lng bounding box is applied in the query itself before the exact haversine filter runs.)
  (Checked/fixed 18 Oct 2026, reported bug: "as platform owner, no option to update an active 3PL partner's
  documents". Root cause - once a 3PL partner/logistic company/vendor record is approved, every write path to
  its documents either blocked the write outright (3PL's `updateApplication` only allows pending/rejected) or
  silently demoted the record back to review on ANY edit, staff-initiated or not (vendor's `saveKycDocuments`).
  Fixed all three the same way: an `asStaff` flag on the write (3PL `replaceDocument`, vendor `saveKycDocuments`;
  logistic companies' `saveOrgDocuments` already had no such restriction, only a missing frontend control) that
  staff-initiated calls set to skip both the status gate and the back-to-review demotion, since staff is already
  the one who would have reviewed it - the vendor/partner's own self-service edit still goes back to review as
  before. Added a "Replace" control next to each already-uploaded document on `TplPartnerDetailPage.tsx`,
  `platform/OrganisationsPage.tsx` and `VendorReviewPage.tsx`, available at any status. Checked the same question
  for vehicles and drivers (also explicitly named): neither has this gap - vehicle document/expiry fields
  (`PATCH /vehicles/:id`) and driver documents (`POST /people/:id/documents`) were already built with "entity
  operational status" and "per-document review status" as two separate things, so staff could already update
  either at any time without forcing a re-approval.)
- Not yet walked (no live/manual walkthrough): customer-app OTP, driver app on a device, a browser walkthrough of
  every screen, load testing.
  (Checked 17 Oct 2026: the three scheduler jobs - document expiry, driver-without-vehicle, quote escalation - are
  NOT an open QA gap the way this line used to imply. All three run from one in-process 60s `setInterval`
  (`scheduler.service.ts`, started unconditionally in `index.ts` - confirmed wired, not dead code) and all three
  have real logic-level test coverage, not smoke tests: exact reminder-marker/digest-count assertions, idempotency
  on a second run, and (for quote escalation) a fast-forwarded scheduler-tick integration test. What the check DID
  find and fix: `runDocumentExpiryJob`'s staff digest and `promptDriversWithoutVehicle`'s notice both ran outside
  a request, where `org-scope.ts` has always deliberately left nothing scoped - a pre-multi-tenancy trade-off that
  became a real cross-tenant leak once there were multiple real companies: both notified every admin/superadmin/
  manager platform-wide, naming one company's specific driver and documents to every OTHER company's staff too.
  `escalateQuietLoads` already did this correctly (passes `PLATFORM` to `notifyStaff` explicitly). Fixed the other
  two the same way - each notified company now gets its own correctly-scoped notification, resolved via the new
  `operatorOrgsOf` helper (`people-common.ts`) since there's no request context to infer it from outside one.)
- UI complexity/duplication audit (owner asked to "think on" this; fixed the KYC-review page's duplicate
  `tpl_partners` pending-count query, now sharing `usePendingPartnersCount` with the sidebar badge). Also since
  fixed, as pure visual/structural refactors with zero behaviour change: the vendor (4-step) and 3PL (3-step)
  onboarding wizards no longer hand-roll their own `Stepper` - both use the shared `frontend/src/components/ui/Stepper.tsx`
  (`variant="panel"` for 3PL's read-only card layout, `variant="inline"` for vendor's clickable row layout);
  `VendorLoadPage.tsx`'s goods list now uses the shared `DataTable` instead of a hand-rolled `<table>`;
  `LoginPage.tsx` (previously one 636-line component) is now a thin 238-line container over
  `frontend/src/components/auth/` - one form component per flow (sign-in/sign-up/forgot/reset), a shared
  `useLoginFlow` hook holding all the logic, same behaviour and tests unchanged.
  Since also fixed (17 Oct 2026, owner asked to continue past the first round): `CompanyKycPage.tsx` now has the
  same `Stepper` vendor/3PL onboarding already had (see §3 above); the eleven-section menu is now nine (Shipments
  folded into Dispatch, Reports into Money); Dispatch's "Optimize"/"Plan a trip" renamed to "Auto-assign
  trips"/"Plan a trip by hand" so a new admin can tell the automatic and manual tools apart by name. Nothing
  product-shaped is left open here - any further nav changes (e.g. fewer than nine sections, different grouping)
  are a fresh owner request, not a continuation of this audit.
- Next phase when the owner says go: N2 matching intelligence (carrier scores, ranked matching, auto-allocation,
  price learning).

## 6. Useful commands
```bash
gh run list --branch test --limit 6                       # CI + deploy status per commit
gh workflow run uat.yml --ref test                         # 91-step story
node e2e/staging/vendor-review.mjs                         # a staging walk (test stage only)
./infra/set-secrets.sh --stage test                        # apply infra/secrets.test.env to the test apps
az containerapp logs show -g margix-rg -n margix-test-api --tail 100 --format text   # API logs (test)
```
History of earlier work: `docs/uat/` (plans, issues, findings), `docs/uat/WORKFLOW-AUDIT.md`.
