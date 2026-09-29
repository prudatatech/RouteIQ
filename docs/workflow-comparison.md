# Workflow comparison: before and after the redesign

Date: 2026-09-29. This compares the app before the redesign (`main` at `7482eb4`) with `ui/redesign`. It covers every workflow in:
- the staff console
- the partner and public pages
- the backend API
- the driver app and the customer app

Each workflow was traced in the code of both versions, including whether the old one made a real API call or was a timer, a hardcoded value or a dead button. Each was then put in one class:
- **Kept:** works the same.
- **Moved:** same capability, somewhere else.
- **Changed:** works differently.
- **Removed (fake):** it never worked, with evidence.
- **Removed (real) / degraded:** a working capability, or part of one, was lost. These are regressions.

## Summary

- Most removals were things that never worked. The biggest groups:
  - **Fake or invented data:** the "neural pipeline" animation, the reinforcement learning optimizer, fake GST verification, the 3PL "provisioning" and activation pages, Scan and Messages tabs with no code behind them, "Call connected" and "Dispatcher notified" messages with no call or message sent, invented revenue, health, pricing and driver-rating figures, and hardcoded 3PL stats.
  - **Dead or broken:** a live map that never drew a vehicle, an audit log that showed blank rows, a delivery signature pad in the wrong colour, and navigation that always sent drivers to the depot.
- Installed mobile apps are safe. Every call the older driver and customer apps make still works against the new backend. The seven removed endpoints were used only by the old web console, and each served invented data.
- Real regressions were found. All 26 below were restored on `ui/redesign` on 2026-09-29 (checks: 223 backend tests, query check, lint with zero warnings, both mobile apps type-checked).

## Regressions and their fixes (all restored)

| # | Area | What was lost or broken | Old behaviour | Fix |
|---|------|--------------------------|---------------|-----|
| 1 | Fleet | Fitness certificate number is silently dropped (new bug) | Saved correctly | Correct field name, with a round-trip test |
| 2 | Routes | Dispatch a route; mark it completed | "Dispatch" and status edit | Dispatch and Mark completed actions, with confirmation |
| 3 | Vendor requests | Price when assigning a vehicle | Flat price and rate per km | Price fields in the assign step |
| 4 | Dashboard | "View vehicle" opened the plain fleet list (new bug) | Focused the vehicle | Opens that vehicle; adds "Show on map" |
| 5 | Fleet | Capacity, load, free kg and bidding-window badge | Shown per vehicle | Capacity column and drawer details |
| 6 | Shipments | "Bidding open" and asking price | Shown in the list | Pill, drawer details, assign hidden while bidding is open |
| 7 | 3PL partners | What changed in a partner's update request | Added, changed and removed corridors | Before/after comparison; rejection reason shown |
| 8 | Dashboard | Pending vendor requests; delay-risk and idle-vehicle alerts | Panel and alerts | Card and alert rows; invented fuel and maintenance alerts removed |
| 9 | Live map | Grouping many vehicles; vehicle-type icons | Clusters, heatmap, icons | Clustering and type icons |
| 10 | Route details | Driver, created time, status timeline | Shown | Restored with real timestamps |
| 11 | Optimizer | Solve-time control | Slider | 10, 30 or 60 seconds |
| 12 | Live map | "Sync GPS now" | Button | Restored |
| 13 | Telemetry | Reconnects after a dropped connection | Reconnected after 5 s | Reconnect with back-off and a "Reconnecting" label |
| 14 | Emergencies | "Open in Google Maps" | Link | Restored |
| 15 | Public and vendor tracking | Remaining-route line and road-based arrival time | Route line and traffic arrival time | Driving route and arrival time from it |
| 16 | Corridors | Signed-out visitors saw "no capacity" | — | "Sign in to see live capacity" |
| 17 | Vendor onboarding | A quick first step | Short form | "Save and finish later" after the company step |
| 18 | 3PL form | Lane and vehicle suggestions, partner-ID suggestions | Suggestions | Restored |
| 19 | 3PL setup | Backend error text | Specific messages | Shared error helper |
| 20 | Driver app | Accidental SOS | Modal and type choice | Hold or countdown with cancel |
| 21 | Driver app | One SOS created two alerts | — | Details update the same alert |
| 22 | Driver app | Accident severity | Serious / minor | "Anyone injured?" stored as severity |
| 23 | Driver app | Report issue took an extra tap, with no reason | 2 taps | Issue button on the card, with a reason list |
| 24 | Driver app | Break took an extra tap | 2 taps | Shortcut, first in More actions |
| 25 | Driver app | GPS off on an active route was easy to miss | Siren | Escalates after 2 minutes |
| 26 | Driver app | "Not now" on a new route re-alerted every 15 seconds | Same | 10-minute snooze; dispatch is told |

## Kept deliberately, not restored

| Removed | Why |
|---------|-----|
| "Escalate to 3PL" | It rejected the vendor's request while saying it had escalated it. A real escalation needs a backend flow, which doesn't exist yet. |
| Revenue, profit, fuel and maintenance cost, vehicle health, driver ratings | Always ₹0, or worked out from fixed constants and odometer remainders. Build these again only on real invoice and cost data. |
| Pricing sliders, hardware-alarm simulator, traffic-anomaly button | Invented prices, fake alerts and a test tool. |
| Scan and Messages tabs, speedometer, "View map" pill | Buttons with no code behind them. |

## Known gaps in both versions (product decisions, not regressions)

- A 3PL partner cannot see their orders or earnings. The tabs have always been placeholders.
- Customers cannot book or track a shipment in the customer app.
- Staff cannot open a bidding window from the console, and windows don't close on their own.
- The driver app captures no signature or photo for proof of delivery, only the receiver's name.
- Stop completion, proof of delivery and SOS are not queued offline in the driver app. Only location pings are.
