# Vocabulary

One word per thing, in text a person reads. The web app, driver app, customer app, notifications, emails and PDFs all use the same words. The design of the flow is in `workflow-blueprint.html`.

This applies to user-visible text only: labels, headings, descriptions, toasts, errors, empty states, button text, aria-labels, notification titles and bodies, and PDF and email text. Never rename code identifiers, API paths, database tables and columns, enum values, query parameters or notification type names.

## The word list

| Say | Instead of | Notes and examples |
| --- | --- | --- |
| shipment | consignment, manifest, cargo manifest | Staff: "Shipments", "Open shipment". Vendor goods: "load". Customers: "shipment" or "booking". |
| load | vendor manifest, vendor request | Vendor-facing text: "Post a load", "Your loads". |
| request | vendor request, shipment request | Staff: "Requests", "New request". Staff see "customer booking" inside Requests. |
| trip | route (a vehicle's journey) | "Trips", "Trip details", "Send trip", "Plan a trip", "Trip replay", "On trip". |
| problem | exception, incident (a case) | "Problems", "Open problems", "Raise a problem". |
| return trip | backhaul, capacity window, pooling, pool loads | "Return trips", "Open a return trip". The tab for joining loads is "Combine loads". |
| transfer | transshipment | "Plan a transfer". |

Keep as they are: booking (the customer's word), lot, stop, claim, trip, shipment, load, request.

### Where the old word stays

- **route** stays for a road path drawn on a map or a navigation route: "Route line", "Open route in Google Maps", "Alternative routes", "No drivable route was found".
- **manifest** stays as the name of the printed paperwork page: "Manifest and label", "Print manifest".
- **traffic incident** stays for incidents on the map. A case that stops goods is a problem.

## The check

`scripts/check-vocabulary.mjs` (Node, no packages of its own) finds the banned words, whole words, any case: consignment, manifest, route, exception, backhaul, capacity window, pooling, pool load, vendor request, shipment request, incident, transshipment.

It reads code with the TypeScript parser from a package's `node_modules`, so imports, identifiers, object keys, paths, comparisons and test files are skipped.

| Target | What is scanned |
| --- | --- |
| `frontend` | String literals and JSX text in `frontend/src` |
| `backend` | String literals in `backend-ts/src` that a person can read (notification titles and bodies, email and PDF text, `HttpError` messages and `detail` replies). Errors thrown as plain `Error`, database queries and logs are skipped |
| `driver` | Values in `driver-app/src/locales` |
| `customer` | Values in `customer-app/src/locales` |

```
node scripts/check-vocabulary.mjs                       # everything
node scripts/check-vocabulary.mjs --only frontend,backend
npm run check:vocabulary                                # in frontend/ or backend-ts/
```

It prints `file:line`, the word, the suggested word and the text, and exits 1 when it finds any. CI runs it for the frontend and backend jobs.

## Allowing an exception

Only for a real exception from the list above. There are two ways.

**Allowlist** (`scripts/vocabulary-allowlist.json`). One entry per file and phrase, with a reason:

```json
{ "file": "frontend/src/components/map/LiveMap.tsx", "phrase": "Route lines", "reason": "The road path drawn on the map." }
```

- `file` is a path from the repo root. A path ending in `/` covers every file under it.
- `phrase` is matched without regard to case. A banned word is allowed when it sits inside the phrase, so "Alternative route" allows only that use and not a plain "route" elsewhere in the file.
- `"whole": true` allows the phrase only when it is the entire text, for example the page title "Manifest".
- `reason` is required.

**Inline**. Put `// vocab-ok: <reason>` on the same line or the line above:

```tsx
{/* vocab-ok: printed paperwork keeps its name */}
<h1>Manifest</h1>
```

Prefer rewording. Add an exception only when the old word is the right one.
