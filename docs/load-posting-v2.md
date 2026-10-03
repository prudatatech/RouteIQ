# Post a load, version 2

The vendor "Post a load" form was rebuilt around how shippers book trucks in India. Frontend only: the body sent to
`POST /vendor/loads` (and `/public/loads/assist`) is unchanged, and the server schema (`backend-ts/src/schemas/loads.ts`)
is not touched.

## What changed and why

| Before | Now |
| --- | --- |
| Goods asked twice (step 1 product 1, step 2 products) | One Goods step, one card per product: search with HSN and GST, quantity, unit, weight, value, handling |
| Fragile / hazmat per product and per load | Fragile, hazmat, temperature stay on the product. The load keeps do not stack, this side up, ODC, and shows fragile / hazmat read-only. Sent special_handling is the union without duplicates |
| Address asked four times | One search box fills Address line, City, Pin code, State (read from the pin) |
| Capacity typed next to a vehicle that has one | Capacity is derived and shown as text ("Fits up to X t, your load is Y t") with a warning when the load is heavier. Still sent as `capacity_t` |
| Request quotation, budget and "who should quote" overlapped | One choice: Get quotes from companies (default) or Book at my price. Then who can see the load |
| Contacts: only the pickup one required | Receiver name and mobile are required too (driver and proof of delivery need them). The server still accepts them empty |
| Site options split across two steps | Each side owns its options: pickup (dock, access, loading help), delivery (unloading help) |
| kg / tonnes unit plus a separate weight | Weight fills from the quantity for kg and tonnes, and stays editable |
| e-Way Bill shown three or four times | One line in the Goods totals and one line in the Review goods section |
| Review repeated route and goods | Summary strip, then Goods, Route and dates, Truck and price, each once |

## The four steps

1. **Route & dates**: pickup and delivery cards (address, dates, contacts, site needs).
2. **Goods**: product cards, totals, e-Way Bill line.
3. **Truck & price**: load type, vehicle, derived capacity, temperature, whole-load handling, pricing, who can see it.
4. **Review**: read-only, Edit goes to the owning step, Submit Load (sign-in only at submit, unchanged).

Recommendations are shown on the step that owns them (`stepForRecommendation`): same city, same-day pickup,
interstate -> step 1; HSN, rate, value, bulk, e-Way, hazmat permit -> step 2; everything else -> step 3. The below-budget warning sits in
the pricing card. The interstate message is shown once, by the tax-basis alert, not again as a suggestion.

## Fields

| Field (draft = payload name) | Step | Rule |
| --- | --- | --- |
| `pickup_*` / `delivery_*` city, address, pincode, lat/lng | 1 | all required, place picked from the search |
| `pickup_date` | 1 | required, today or later |
| `delivery_date`, `pickup_slot` | 1 | optional |
| `pickup_contact_name/phone`, `delivery_contact_name/phone` | 1 | all required, 10-digit mobile |
| `loading_dock`, `access_restrictions`, `loading_help` | 1 (pickup) | optional |
| `unloading_help` | 1 (delivery) | optional |
| `items[]` name, HSN, rate, quantity, unit, weight, value, handling | 2 | name 3+ chars, HSN, rate, quantity and weight required |
| `load_type` | 3 | required |
| `vehicle_class` | 3 | required for FTL; for PTL optional, sent as `null` when empty |
| `capacity_t` | 3 | never typed: server suggestion, or the chosen vehicle's max (min) once the vendor picks one |
| `temp_*` | 3 | required when any product is temperature-controlled |
| `special_handling` | 3 | load-level list plus fragile / hazmat from the products |
| `quote_requested`, `budget_inr` | 3 | quotes: budget optional. Book at my price: `quote_requested=false`, budget required (> 0) |
| `routing`, `company_ids` | 3 | open, or 1 to 10 chosen companies |

Behaviour (docs/order-routing.md): with quotes, companies quote within 2 hours; at my price, a company can accept
directly at the budget.

## Old saved drafts

A saved guest draft now carries `v: 2`. A draft without `v` is from the five-step form; `mergeDraft` maps its step:
old 0 and 1 -> 1 (Goods), old 2 -> 0 (Route), old 3 -> 2 (Truck & price), old 4 -> 3 (Review). It also moves a
load-level fragile / hazmat flag onto the first product, and sets "get quotes" when the old draft had no price. A repost
(`repostToDraft`) does the same and still clears both dates; it opens on step 0. `?resume=1` after the email sign-in
still opens the review (`LAST_STEP`).

Code: `components/load-post/` (`logic.ts` payload and numbers, `draft.ts` migration and repost, `validate.ts` checks and
recommendation steps).

## UX pass (HSN search on every product, shorter first step)

Frontend only; draft and payload field names are unchanged.

- **HSN search (`HsnSearch`, `HsnList`, `hsnOpen`)**: a real combobox. ArrowUp/Down move an active option
  (`aria-activedescendant`, `aria-selected`), Enter picks, Escape and Tab close. When the box gets focus it scrolls
  under the sticky header (smooth, plain jump for reduced motion) so the list has room; the list is capped to the
  visible height (`visualViewport`, at least 12rem), scrolls inside itself, shows 6 of up to 8 matches with
  "Show all N" and an "N matches" footer. Descriptions wrap to two lines. Opening one row's list closes any other.
  Picking moves focus to Quantity of the same row.
- **Products**: only the product being edited is open. A finished one (name, HSN, rate, quantity, weight) folds to
  `2. Basmati rice · HSN 1006 · 5% · 20 bags · 1,000 kg · ₹40,000` with Edit and Remove. Add another product opens the
  new row, scrolls to it and focuses its search. A row with a validation error opens. Fragile / temperature / hazmat
  sit behind a Handling chip (open when a flag is set).
- **Route & dates**: pickup and delivery side by side from md (wider than the 720px column from lg). One address search
  per side; after a pick (or a restored address) a one-line summary with Edit address (and Done); before a pick, the
  search and "Enter the address manually". City, pin code and state share a row; date and slot share a row; contact name
  and mobile share a row from sm. Site details are a collapsed "Site details (optional)" per side, open when a value is
  set. Any address error opens the fields.
- **Navigation**: a step change scrolls smoothly to the top; a refused Next scrolls to and focuses the first invalid
  field (`useScrollToFirstInvalid`). Back/Next is a sticky bottom bar on phones (safe-area padding). The stepper is
  "Step 2 of 4 · Goods" over a thin four-segment bar on phones. Scroll helpers: `useScrollIntoView.ts`.
- Tests: `loadPostUx.test.tsx` (keyboard, products 2 and 3, one list at a time, folding, address summary, site details,
  scroll calls).

## Backend: priority, recommended range, direct booking (2 Oct 2026)

The form drops quotes versus own price, the budget, "who can see it", delivery date, dock, access restrictions and
loading/unloading help. It adds a priority. Details in `docs/order-routing.md`.

- `POST /vendor/loads` accepts `priority` (`high` | `medium` | `low`, default `medium`). Every earlier field is still accepted
  (the web sends null / false for the dropped ones; the columns stay).
- The server stores `price_min_inr` and `price_max_inr`: the recommended range from the same estimator as
  `POST /public/loads/assist` (shape unchanged: `estimate { low, high, distance_km, label }`), whole rupees, never taken from
  the client. Null when no estimate is possible.
- Responses of posted loads (create, detail `load`, `/vendor/loads/mine`, the "My loads" board, quotes summary) include
  `priority`, `price_min_inr`, `price_max_inr`. A repost draft has `priority`.
- A load posted without `quote_requested` / `budget_inr` is direct-book: a company books it at any price inside the range
  (`POST /company/loads/:id/accept { amount_inr }`, 400 outside it).
- Companies are told in internal order: high priority goes first to the bigger networks (own active vehicles plus those of
  active affiliated 3PL partners), urgent; medium and low go to all.
## Owner changes 2 Oct

Frontend, with the backend change that adds `priority` and a server-computed recommended range
(`price_min_inr` / `price_max_inr`).

**Step 1, Route & dates**
- No Address line. `pickup_address` / `delivery_address` is the picked place's full formatted address (max 500). City, Pin
  code and State stay editable. "Enter the address manually" opens those three fields; with no pick the address sent is
  built from city, pin code and state, but a search pick is still required (lat/lng are required numbers), and the form says so.
- Removed: the whole pickup "Site details" block, the delivery "Need unloading help", and "Preferred delivery date".
  The payload sends `loading_dock: false`, `access_restrictions: null`, `loading_help: false`, `unloading_help: false`,
  `delivery_date: null`.
- New **Priority** (High / Medium default / Low), a segmented control after the cards, each with a one-line hint. Draft and
  payload field `priority`.

**Step 2, Goods**
- A product's multi-rate / HSN note (server `multi_rate`, `hsn_ambiguous`, matched by `item_index`, `items.N.` in the fix, or
  the HSN code in the message; plus the form's own line when `rate_options > 1`) sits inside that product's card or summary
  row, not in a list at the bottom.
- HSN code and GST rate are always editable. A pick prefills them; the code (4 to 8 digits) is looked up again on blur only
  when it changed, and the GST rate Select lists the code's rates first, then the other GST 2.0 rates. No lock icons;
  `hsn_locked` is gone.

**Step 3, Truck & price**
- Load type is a compact segmented control. Vehicle type: "Recommend for my goods" (default, shows `assist.suggested.vehicle_class`
  with capacity, and that class is sent) or "Choose myself" (a Select with capacity text). Draft field `vehicle_mode`.
  Vehicle is required for FTL only; in recommend mode with no suggested vehicle the person is asked to choose one.
- Removed the pricing choice, budget and "Who can see this load?". One **Recommended freight** card shows
  `assist.estimate` (range, distance, "Logistic companies can book your load at any price in this range."), a skeleton while
  loading, or "We will share the range once a logistic company reviews the route." Payload: `routing: 'open'`, no
  `company_ids`, `quote_requested: false`, `budget_inr: null`.

**Review, confirmation, lists**: Review shows priority, the range and "Recommended: X" / "Chosen: X". Confirmation shows
priority and range, with no "quotes within 2 hours". My posted loads and the staff load details show priority and range.

**Logistic company side**: the market board has Priority (Urgent for high) and Recommended freight columns; the load drawer
(`QuotePanel`) shows both. For a load with a range and no quote request the company enters an amount (prefilled with the
minimum, validated inside min to max) and books with `POST /company/loads/:id/accept { amount_inr }`. With no range the
old accept at the vendor's budget stays. The quote form shows only when `quote_requested` is true. The board is not re-sorted.

**Old drafts**: `mergeDraft` drops budget, quote, routing, companies, delivery date and site fields (never sent), defaults
priority to medium, and sets `vehicle_mode` to manual only when `transport_touched` and a vehicle were saved. A repost keeps
the payload's `priority`, clears only the pickup date, and uses manual vehicle mode when it had a vehicle.
