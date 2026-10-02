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
