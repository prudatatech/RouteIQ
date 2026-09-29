# UI plan: one theme, simple and consistent

Status: proposed, 2026-09-29. Based on the UI/UX assessment of the web console, partner and public pages, the driver app and the customer app.

The goal is one product that looks and behaves the same everywhere, and that someone can use all day without having to think about it. We fix things one at a time, in the order below. Each step is small enough to review on its own and leaves the product better than before.

## 1. Decisions this plan assumes

Where the assessment asked for a decision, this plan uses the recommended option. Change any of them before step 2.1 and the plan still holds.

| # | Decision | Default used |
|---|----------|--------------|
| 1 | Product name | **MargixIndia** everywhere (it matches the domain). Drop "Margix", "margixindia" as a display name, and "RouteIQ Marketplace". "by Prudata" appears only on landing and sign-in. |
| 2 | Brand colour | **Gold** only, on web and both apps. Blue, green and teal stop being brand colours. |
| 3 | Theme | **Light only.** The tokens are built so a dark theme can be added later without touching pages. |
| 4 | AI Hub and Cargo network | **Fold in.** AI Hub suggestions move into Route optimization and the Dashboard. Cargo network becomes "Backhaul pooling". |
| 5 | Optimizer algorithms | **Fix GA, remove "Reinforcement Learning"** until it exists. |

## 2. The standard theme

This is defined once and used everywhere. Values come from what the code already uses most, so migrating a page is mostly a matter of deleting code.

### Colour

| Role | Value | Use |
|------|-------|-----|
| Background | `#F4F4F5` | Page background |
| Surface | `#FFFFFF` | Cards, tables, dialogs |
| Subtle surface | `#FAFAFA` | Table headers, hover rows |
| Border | `#E4E4E7` | All borders and dividers |
| Text | `#18181B` | Body text and headings |
| Muted text | `#5B5B63` | Secondary text. Passes contrast; replaces `#71717A`. |
| Accent | `#8C6600` | Links, active nav, icons, focus ring |
| Accent fill | `#FFC107` | Primary buttons and selected states, always with dark text |
| Accent soft | `#FFF4D1` | Selected rows, active nav background |
| Success | `#15803D` on `#DCFCE7` | Delivered, approved, online |
| Warning | `#B45309` on `#FEF3C7` | Delayed, pending, low fuel |
| Danger | `#B91C1C` on `#FEE2E2` | Failed, rejected, SOS, destructive actions |
| Info | `#1D4ED8` on `#DBEAFE` | Neutral statuses only (for example "In transit"), never branding |

Rules:
- Bright gold is never used for text on white.
- Status is never shown by colour alone. Every status pill has a text label.
- There are no gradients, glows, glass blur or grid backgrounds.

### Type

- One font for the UI: **Inter**, loaded once in `index.html`. **JetBrains Mono** is used only for IDs, plate numbers, e-way bills and coordinates.
- `Space Grotesk`, `Plus Jakarta Sans` and `Outfit` are removed.
- Seven sizes, and nothing below 12 px:

| Token | Size | Use |
|-------|------|-----|
| xs | 12 px | Labels, timestamps, table meta |
| sm | 14 px | Table cells, secondary text, buttons |
| base | 16 px | Body text, form fields |
| lg | 18 px | Card and section titles |
| 2xl | 24 px | KPI values, dialog titles |
| 3xl | 30 px | Page title (every page, same style) |
| 5xl | 48 px | Landing page hero only |

- Weights: 400 for body, 500 for labels and buttons, 600 for titles. There is no `font-black`.
- Sentence case everywhere. All caps is used only for tiny status pills, if at all.

### Space, shape and size

- **Spacing:** 4, 8, 12, 16, 24, 32, 48 and 64 px.
  - Page padding is 24 px (16 px on phones).
  - Gaps between sections are 24 px.
- **Radius:** 8 px for buttons, inputs and chips; 16 px for cards and dialogs; full for pills and avatars.
- **Elevation:**
  - Cards have a border and no shadow.
  - Menus and popovers use a small shadow.
  - Dialogs use a large shadow.
- **Width:** console content is at most 1280 px, forms at most 720 px, and maps are full-bleed.
- **Controls:** 40 px high on web and 48 px on mobile (touch target).

### Words

- Name things the way a dispatcher would: Dashboard, Shipments, Fleet, Routes, Route optimization, Bids, Vendor requests, 3PL partners, Analytics.
- Use plain verbs on buttons: "Create shipment", "Approve bid", "Sign in".
- Do not use internal code names. "Neural", "Nexus", "Command Control", "Grid", "Vector" and "Synchronizing" are not allowed in UI copy.
- Empty states say what is missing and offer one action. For example: "No shipments yet. Create shipment".

### Mobile apps

- Both apps use the same colours, font and type scale as the web. There is one `src/theme.ts` per app.
- Tokens live once in `design/tokens.json`. A small script generates the web CSS variables and both `theme.ts` files. CI fails if the generated files are out of date.

## 3. Rules for every step

Each step below is done only when all of these are true:

1. It uses only theme tokens and shared components. There are no raw hex values, pixel sizes or inline styles.
2. Loading, empty and error states exist and read clearly.
3. It works at 375 px (phone), 1280 px (laptop) and 1600 px (wide), with nothing clipped and no horizontal scroll.
4. It is usable with the keyboard only. Every icon-only button has a label.
5. No data is invented. If there is no real data for something, it is not shown.
6. `tsc`, lint and build pass. Backend tests pass if the backend was touched.
7. Before and after screenshots are attached to the commit or PR.

Work happens on one branch per phase (`ui/phase-1`, `ui/phase-2`, and so on), with one commit per step. You review each phase before it is merged into `main`.

## 4. The plan, step by step

Effort: S is under a day, M is 1–3 days, L is about a week.

### Phase 1: Trust fixes

These make the product look fake or broken. They are fixed first and do not wait for the new theme.

| Step | What | Where | Effort |
|------|------|-------|--------|
| 1.1 | Replace "Seal Logistics Forwarders Pvt. Ltd." in the KYC declaration with the vendor's own company name. | `VendorDocumentsPage.tsx` | S |
| 1.2 | Delete the fake 3PL activation page and route `/3pl-portal/activate` to the real setup. | `TplActivationPage.tsx`, `App.tsx` | S |
| 1.3 | Remove the `admin@safexpress.com` login shortcut. Replace the superadmin email placeholder with "you@company.com". | `LoginPage.tsx` | S |
| 1.4 | Make optimizer options match the ML service. Fix the `genetic`/`ga` mismatch, remove "Reinforcement Learning", and show the algorithm that actually ran. | `OptimizePage.tsx`, `ml-service/main.py` | S |
| 1.5 | Replace every hardcoded value on the web driver dashboard with the route it already loads, or remove the widget. Add clear and redo to the signature pad. | `DriverPage.tsx` | M |
| 1.6 | Make the Fleet "Live Sync" and "Active GPS" badges come from real telemetry (last ping time), or remove them. Replace the fake "Neural Route Pipeline" animation with a real request state. | `FleetPage.tsx`, `ShipmentsPage.tsx` | S |
| 1.7 | Fix broken screens: blank Live Map, squeezed dashboard map, the "Needs attention" count mismatch, and the wrong context key on vendor home. Remove invented figures from the landing preview. | `LiveMapPage`, `DashboardPage`, `VendorPortalPage`, `LandingPage` | M |
| 1.8 | In the customer app, show a clear message when location permission is denied. | `customer-app` | S |

### Phase 2: Foundation

This phase builds the theme and the parts that every page will use. Pages are not restyled yet.

| Step | What | Effort |
|------|------|--------|
| 2.1 | Add `design/tokens.json`. Generate CSS variables and Tailwind config from it, and load Inter and JetBrains Mono once. Remove the other fonts, glass, glow and grid styles from `index.css`. | M |
| 2.2 | Add `Button` (primary, secondary, ghost, danger, icon; loading state) and `IconButton` (label required). | S |
| 2.3 | Add form parts: `Field` (label, hint, inline error, required mark), `Input`, `Select`, `Textarea`, `Checkbox`, `SearchInput`, and a place search built on `services/geocoding.ts`. | M |
| 2.4 | Add `StatusPill` with one status-to-colour map for shipments, routes, bids, KYC and vehicles, used everywhere. | S |
| 2.5 | Add `Modal` (S/M/L, focus trap, Esc to close), `Drawer` for detail panels, and `ConfirmDialog`, which replaces every `alert()` and `confirm()`. | M |
| 2.6 | Add `PageHeader` (title, subtitle, primary action, filters), `Card`, `Tabs` (synced with the URL), `EmptyState`, `Skeleton` and `ErrorState`. | M |
| 2.7 | Add `DataTable` with sorting, paging, sticky header, loading, empty and error rows, and a stacked-card layout on phones. | M |
| 2.8 | Make the shells responsive: a collapsible admin sidebar with a phone menu, a vendor phone menu, one content width, and one header style. | M |
| 2.9 | Add the guardrail lint rules: no raw hex, arbitrary pixel sizes, arbitrary radii or inline `style` in `pages/`. They start as warnings and become errors page by page as pages migrate. | S |

The existing `components/ui/index.tsx` is replaced by these components, with one file per component.

### Phase 3: Daily operations screens

These are the screens operators use every day, and they come first.

| Step | What | Effort |
|------|------|--------|
| 3.1 | New navigation: Operations, Planning, Marketplace, Insights, Admin (see section 5). Rename every page to its plain name. | S |
| 3.2 | **Dashboard:** KPI row (real data only), a map at proper height, "Needs attention" list, recent shipments table with paging. This page becomes the reference layout. | M |
| 3.3 | **Shipments:** a dense table with status filters and search, a detail drawer, and the create button always visible. | M |
| 3.4 | **Create shipment:** turn the 958-line single-scroll modal into a 4-step wizard (Route, Cargo, Vehicle, Review) that matches the vehicle wizard. | M |
| 3.5 | **Fleet:** a table with place names instead of coordinates, a truthful "Last seen" column, correct fuel units, and a detail drawer. | M |
| 3.6 | **Routes and route details:** standard header, a table with readable ETA, and a details page on the shared layout. | M |
| 3.7 | **Route optimization:** a plain layout with only working algorithms and a clear result. AI Hub reroute suggestions move here as a panel. | M |
| 3.8 | **Bids:** one page that merges Capacity Bidding and the Superadmin bids tab. Open windows come first, it filters by status, and bids are approved inline. | M |
| 3.9 | **Vendor requests:** one page that merges the Dashboard panel and the Superadmin tab. | S |
| 3.10 | **Emergencies:** an SOS list with severity, time and actions, plus the map. | S |
| 3.11 | **Live map:** a full-screen fleet map, added to the navigation. | S |

### Phase 4: Admin and insights

| Step | What | Effort |
|------|------|--------|
| 4.1 | Split Superadmin into Users, KYC review (vendors and 3PL in one queue) and Audit log, under Admin. | M |
| 4.2 | **3PL partners:** one area running from directory to verification to active, which replaces Network plus Verification. | M |
| 4.3 | **Analytics:** rebuild on shared components with a few meaningful metrics. There are no ₹0 "LIVE" tiles; if there is no data, show an empty state. | M |
| 4.4 | Retire the AI Hub page and remove the test "Inject traffic anomaly" button. | S |
| 4.5 | Rename Cargo network to **Backhaul pooling**, split it into one file per tab, and give tabs plain labels. | M |

### Phase 5: Partners and public pages

| Step | What | Effort |
|------|------|--------|
| 5.1 | **One sign-in page** with "Staff" and "Vendor or 3PL partner" options, which replaces the three login pages. | M |
| 5.2 | **Company & KYC wizard** for vendors, with a progress indicator. Company details are entered once and the declaration uses the vendor's own name. | L |
| 5.3 | **Post a load** as 3 steps (Route, Cargo, Review), with inline errors and a map visible on phones. | M |
| 5.4 | **Vendor home and corridors:** shared header, responsive search, and a KYC banner shown before bidding instead of a toast afterwards. | S |
| 5.5 | **One tracker card** shared by customer tracking, vendor tracking and mobile tracking. | M |
| 5.6 | **3PL onboarding and dashboard:** share the duplicated form sections, and confirm before a document upload resets approval. | M |
| 5.7 | **Landing page:** one primary action per audience, no invented numbers, and the correct name. | S |

### Phase 6: Mobile apps

| Step | What | Effort |
|------|------|--------|
| 6.1 | Generate `theme.ts` for both apps from the shared tokens, load Inter, and fix safe areas. | S |
| 6.2 | **Customer app:** one brand colour across all screens, visible location errors, accessibility labels, and a complete tab bar. | M |
| 6.3 | **Driver app home:** a status strip (GPS, tracking, offline), a single "next action" card using the existing swipe-to-confirm, and a bottom sheet for less frequent actions. The 1,959-line screen is split into parts. | L |
| 6.4 | **Driver alerts:** one SOS button with its own shape and colour on every screen. The siren is kept for new routes and dispatch calls only. Only one modal can be open at a time. | M |

### Phase 7: Clean-up

| Step | What | Effort |
|------|------|--------|
| 7.1 | One shared `Map` component with fleet, route, incident and tracking modes, which replaces the five map implementations. | L |
| 7.2 | Delete the old components, unused CSS and dead styles. Turn the guardrail lint rules into errors for the whole app, and lower `--max-warnings`. | S |
| 7.3 | A final pass at 375, 1280 and 1600 px across every page, plus a keyboard-only pass. | M |

## 5. Navigation

| Group | Pages |
|-------|-------|
| Operations | Dashboard, Live map, Shipments, Fleet, Emergencies |
| Planning | Routes, Route optimization, Backhaul pooling |
| Marketplace | Bids, Vendor requests, 3PL partners |
| Insights | Analytics |
| Admin | Users, KYC review, Audit log |

The following are removed as separate destinations: AI Hub, the Superadmin bids and requests tabs, the fake 3PL activation page, and the two extra login pages.

## 6. Order and rough size

| Phase | Effort | Can start after |
|-------|--------|-----------------|
| 1. Trust fixes | about 1 week | now |
| 2. Foundation | about 2 weeks | the decisions in section 1 |
| 3. Daily screens | 2–3 weeks | Phase 2 |
| 4. Admin and insights | about 1.5 weeks | Phase 2 |
| 5. Partners and public | 2–3 weeks | Phase 2 |
| 6. Mobile apps | about 2 weeks | step 2.1 (tokens) |
| 7. Clean-up | about 1.5 weeks | Phases 3–6 |

Phases 4, 5 and 6 can run in parallel once Phase 2 is merged.
