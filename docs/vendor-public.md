# Vendor entry: post a load before signing in

The vendor's primary entry is **Post a load**, at `/vendor/request`. A visitor can fill in pickup and delivery,
goods, truck requirements and priority, see the recommended freight range, and review the complete load without
an account. Sign-in is required only when submitting. The saved browser draft survives sign-in and reposting.

The owner requested removal of the duplicate **Find a truck** flow. Its lane-search page and standalone
`POST /public/quote` endpoint are removed. All entry links go directly to the load form. Old `/ship` bookmarks
redirect to `/vendor/request`; there is no lane-search form or separate guest-price hook behind that address.

## Separate workflow: return-trip space

`/vendor/return-trips` still lets guests browse real spare capacity and prepare a bid. This commits to an existing
truck's capacity window, unlike posting a new load for companies to take. The bid is saved before sign-in and
restored for confirmation afterwards. Removing the lane search does not remove this workflow.

## Public APIs retained for their other callers

- `POST /public/loads/assist`: goods totals, GST, e-way requirements, handling recommendations, suggested vehicle
  and indicative freight for the complete load draft. Read-only, rate limited, with `Cache-Control: no-store`.
- `GET /public/spare-space`: open capacity of active companies for guest Return trips. Only company name/city,
  origin/destination cities, departure window, vehicle type, free kg and indicative price are exposed.
- `GET /public/companies`: active company names, cities, vehicle types and completed-trip counts. Retained for
  the company-picker compatibility component; removing the lane-search page does not retire order-routing APIs.
- `GET /public/cities`, `/public/pincode/:pin`, `/public/hsn/search`, `/public/hsn/:code`,
  `/public/vehicle-classes`, `/public/goods-categories`: reference data for Post a load.
- `GET /public/stats` and `/public/vehicle-share/:token`: landing-page counts and shared vehicle tracking.

Spare-space and company responses never expose plates, driver details, contacts, GSTIN, coordinates or vehicle IDs.
Pending, suspended and rejected companies are excluded. Shared signed-in pricing remains available for dispatch,
shipment creation and bids; it is independent of the retired guest quote endpoint.

## Navigation and drafts

The landing page and guest vendor header lead to Post a load. My loads, invoices, claims and Company require a
vendor account. Login keeps the saved load and returns to its review step. Retired `/ship` login destinations
resolve to `/vendor/request`, respecting account-kind restrictions.

Drafts live in `localStorage` under `margix:guest-draft:<kind>`, expire after 24 hours, and are cleared after posting.
All storage access is guarded. No load is posted before the vendor explicitly submits it.

## Verification

Targeted tests cover account redirects, load posting, guest drafts, public response privacy and the removed quote
endpoint. CI runs the full checks on GitHub; UAT runs the 91-step story on a throwaway database. The guest-entry
browser scenario exercises desktop and mobile widths on that runner without sending messages or posting loads.
