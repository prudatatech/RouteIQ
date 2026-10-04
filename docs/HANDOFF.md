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
| Postgres Flexible Server | `margix-test-pg` (B1ms) | `margix-pg` (B2s) |

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

## 4. Azure pitfalls (each broke something once)
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
- Product gaps: a real finance role (finance/dispatcher/ops map to one role); `/capacity/nearby-vendors` lists all
  vendors to any company; `/public/companies` caps at 200; finance lists unpaginated; vendor company details are
  asked three times (sign-up, business profile, KYC form); no consignee GSTIN on loads (needed for e-way bills).
- Not yet walked: scheduler jobs (document expiry, driver-without-vehicle, quote escalation), customer-app OTP,
  driver app on a device, a browser walkthrough of every screen, load testing.
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
