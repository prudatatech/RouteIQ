# Phase 3a: explore before signing in (guest vendor)

A vendor arriving at portal.margixindia.com can do everything a shipper does when shopping for transport,
with **no account**:

- search a lane;
- see trucks with spare space on it;
- see the logistic companies that serve it;
- get an indicative price;
- fill in a full load.

Sign-in is asked for only at the **commit** step: posting the load, bidding on spare space, or booking.
After signing in (or signing up), the vendor lands back on the same step with everything they typed still
there. Industry pattern: guest browse and quote, with an account required at checkout.

## What a guest may see (and what they never see)

| Shown | Never shown to a guest |
|---|---|
| company name, its city, the vehicle types it runs, how many trips it has completed | phone, email, GSTIN, people |
| spare space: origin and destination **city**, departure window, vehicle type, free kg, indicative price | number plate, driver, live position, exact coordinates, vehicle id |
| indicative price range for a load | the rate card, margins, other vendors' bids |

Only `active` logistic companies appear: never `pending`, `suspended` or `rejected` ones. Never show
anything from a company's private records.

## API (backend-ts, `routes/public.routes.ts`, no sign-in)

Every endpoint has an IP rate limit (`rateLimitByIp`), a short cache (`Cache-Control: public, max-age=60`
where the answer is not request-specific), zod validation, and read-only access.

- `GET /public/spare-space?from=<city>&to=<city>&date=YYYY-MM-DD&vehicle_type=&min_kg=` lists open capacity windows
  (`capacity_windows`, status open, departure today or later) across active companies. Each item is
  `{ id, company: { id, name, city }, from_city, to_city, departs_from, departs_to, vehicle_type, free_kg, price_per_kg_from }`.
  City matching is case-insensitive and on city names. With no filters, it returns the next 50 by departure.
- `GET /public/companies?city=&vehicle_type=` lists active logistic companies:
  `{ id, name, city, vehicle_types: string[], trips_completed: number }`. The counts are aggregates only.
- `POST /public/quote` takes the body of `/pricing/quote` without `source`, and returns the same price
  range. Nothing is written. It uses a stricter rate limit (20 per minute per IP).
- `GET /public/cities?q=` (optional, if no city source exists yet) gives city suggestions from depots and
  windows.

These sit under the already-mounted `/api/v1/public` router.

## Web (frontend)

- **`/ship`** is the public "Find a truck" page and the guest home for vendors. A lane search (from, to, date,
  weight, vehicle type) shows three results together: an indicative price, trucks with spare space on the
  lane, and the companies that serve it. Each spare-space card has **Book this space**, and the page has
  **Post this load**. Both lead to the commit step below.
- **`/vendor/request` (post a load) opens without an account.** A guest fills in the whole form and sees the
  quote. **Post load** saves the form as a local draft, then sends them to
  `/login?as=vendor&next=/vendor/request?resume=1`. Back on the page, the draft is restored and shown as a
  summary with one **Confirm and post** button. Nothing is posted without that click.
- **Bidding on spare space** follows the same pattern. The draft holds the window id and the bid, and
  `next=/vendor/return-trips?bid=<id>&resume=1` brings the vendor back to it.
- `/vendor/return-trips` shows real spare space to guests, from `/public/spare-space`, instead of an empty
  sign-in prompt. `/vendor/loads` keeps its sign-in prompt (it lists the vendor's own loads), plus a
  link to `/ship`.
- **Drafts live in `localStorage`, under `margix:guest-draft:<kind>`.** Every read and write is wrapped in
  try/catch, and a draft expires after 24 h. It is cleared once posted. No guest data goes to the server
  before sign-in.
- **The login page with `as=vendor`** makes signing up the obvious choice ("New here? Create a vendor
  account") and honours `next` after both sign-in and sign-up.
- **The landing page** gets two primary actions: **Find a truck** (`/ship`) and **Post a load**
  (`/vendor/request`).
- **The vendor layout for guests** shows the public sections (Find a truck, Post a load, Return trips)
  and a **Sign in / Sign up** button, but not the account-only items.

## Done when

- A signed-out browser can search a lane, see spare space, companies and a price, and fill a load. It
  hits sign-in only on Post or Book, then posts the restored draft with one click.
- No guest response contains a plate, phone number, GSTIN, driver, coordinates or vehicle id. A test
  asserts this on every public endpoint.
- Pending and suspended companies never appear. This is tested.
- CI is green and the 75-step story still passes.
