# Roadmap build plan: finish the planned features

Date: 2026-09-29. Features that showed invented numbers, timers or dead buttons were the planned product, not mistakes. Each one gets built on real data and real integrations. Where no data exists yet, the page shows a clear empty state. It never shows made-up values.

Credentials the backend already has are used where they help:
- TomTom (traffic)
- OpenWeather (weather)
- SparkGPS (telematics)
- Google Maps and Mappls (distances)
- Twilio (SMS)
- ULIP and the e-way bill GSP (government lookups, used only when configured)
- the telematics webhook secret

## Streams

| Stream | What gets built | Real data source | Migrations |
|--------|-----------------|------------------|------------|
| **F. Finance** | Invoice created on every delivery. Expense log for fuel, maintenance, tolls and other costs, entered by staff. Profit and loss: revenue, costs, net profit, profit per truck, cost per km. Most profitable routes. Revenue and profit charts. | Freight charge, accepted bid amounts and manifest prices; recorded expenses; fuel from telemetry at the configured fuel price | `20260930001*` |
| **H. Fleet health and alarms** | Service schedule per vehicle (by km and by date), service log, and a health score from overdue service, document expiry and device fuel. Telematics webhook and rules that raise alerts: overspeed, long idle, GPS lost, low fuel, harsh braking and geofence breach when the device reports them. Cargo alerts come from these rules. | Service records, vehicle documents, telemetry, device webhook | `20260930002*` |
| **P. Pricing, traffic and weather** | Price recommendation from the rate card, driving distance, weight, vehicle type, demand in the corridor, and the history of accepted bids. Used in backhaul, vendor post-a-load and customer quotes. Traffic incidents from TomTom along active routes create reroute suggestions. Real weather and traffic factors feed the optimizer. | `system_settings` rate card, Mappls or Google distances, bid history, TomTom, OpenWeather | `20260930003*` |
| **T. 3PL network** | Escalate a vendor request to 3PL partners on the matching corridor. Partners accept or decline in their dashboard, and the order is assigned. The 3PL dashboard's Orders and Earnings tabs. Partner stats: acceptance rate, SLA breaches and rating given by staff. GSTIN checksum check, with an optional online lookup when credentials exist. | Escalations, acceptances, delivery times, staff ratings | `20260930004*` |
| **D. Driver app** | QR or barcode scan to verify a parcel at pickup and delivery. Messages between driver and dispatch, with the staff side in the console. Delivery photo and signature, stored securely. Offline queue for stop completion, proof of delivery and SOS. Call dispatch using the dispatcher's number from settings. Live speed display. | Shipment codes, messages table, storage, device GPS | `20260930005*` |
| **C. Customer app** | Get a quote from the pricing engine, book (creates a real shipment request), and track the booking. Today or scheduled pickup. | Pricing engine, bookings, public tracking | `20260930006*` |
| **B. Operations and insights** | Staff open and close bidding windows from the console. A scheduler closes windows and times out driver confirmations. Driver performance: on-time rate against the planned arrival stored at dispatch, and staff ratings after delivery. AI Hub comes back as **Insights**: delay risk, idle vehicles, traffic incidents, reroute suggestions and demand by corridor, all from real sources. Live figures on the landing page from public aggregate counts. | Bidding tables, route stops with planned arrival times, ratings, ML and traffic insights | `20260930007*` |

## Order

1. **Batch 1**, in parallel: F, H, P, T.
2. **Batch 2**, in parallel: D, C, B. These build on pricing and escalations from batch 1.

Each stream follows the same rules:
- shared components and theme
- zero lint warnings
- tests for every new endpoint
- the query check must pass
- migrations are applied after review

## Decisions (made so work can continue; change any of them)

- **Money:** stored in rupees as `numeric(12,2)`. GST is shown separately using the rate on the shipment or cargo. The invoice number format is `INV-YYYYMM-####`.
- **Fuel price:** a setting in `system_settings` (`fuel_price_per_litre`), editable by staff. No hardcoded constant.
- **Pricing:** the recommendation is a range (low, suggested, high) with an explanation of the factors. Staff and vendors can always override it.
- **Driver rating:** 1 to 5 stars from staff after a delivery. On-time means arrival within 30 minutes of the planned arrival, and that window is a setting.
- **Escalation to 3PL:** it goes to partners whose corridor matches the pickup and drop cities (by name or state). The first partner to accept wins. The request is marked "escalated" and then "assigned to partner".
- **Chat:** text only in version one. Messages are kept per route or shipment.
