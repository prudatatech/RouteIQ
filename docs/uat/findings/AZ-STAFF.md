# UAT findings: staff screens on Azure (live data)

Pass 1, 1 Oct 2026, signed in as superadmin on https://gentle-plant-0cd625000.5.azurestaticapps.net.
No API call failed (no status >= 400) on any page visited unless noted.

| # | Sev | Title |
| --- | --- | --- |
| AZS-01 | Major | Two identical "Delay" cases opened for the same lot at the same moment |
| AZS-02 | Major | Delay cases stay open and overdue after the lot is delivered |
| AZS-03 | Major | Invoices show "Billed to: Not recorded" |
| AZS-04 | Minor | Invoice total ₹1,50,000.04: a stray 4 paise suggests GST back-calculation rounding |
| AZS-05 | Minor | Trips list has no trip number or shipment, so trips on the same truck can't be told apart |
| AZS-06 | Minor | Completed trips show the planned ETA ("21 h 25 min") instead of what happened; cancelled trips with 0 stops still show a distance |
| AZS-07 | Minor | A person's name with a trailing space ("Vishal ") in the missing-documents notice |
| AZS-08 | Major | A lot was delivered with no pickup ever recorded; the app back-fills it |
| AZS-09 | Major | A split master's drawer says "Not assigned", "Assign a vehicle to message its driver" and "no driver to rate" for a delivered booking |
| AZS-10 | Major | The delay cases on lot B were opened about 30 min after lot B was delivered |
| AZS-11 | Minor | Master status history: "Delivery failed" while attempts read "0 of 3", and "Created" listed twice |
| AZS-12 | Gap | No e-way bill on lots of a ₹1,50,000 consignment, with no warning (one is required above ₹50,000) |
| AZS-13 | Minor | A split master shows "Destination —" instead of its 3 drops |
| AZS-14 | Major | Driver pay lists 4 of the 7 completed trips; Vishal's DL01AL0010 trip and two of MUNNA's are missing |
| AZS-15 | Major | Analytics shows "Revenue ₹2,29,163 before GST", which equals the invoice totals including GST |
| AZS-17 | Major | Invoices are issued while the company profile (seller name, GSTIN, address) is empty |
| AZS-18 | Major | With no fuel price and no expenses, Analytics reports costs ₹0 and net profit = revenue, with no warning |
| AZS-19 | Major | The vehicle page shows DL01AL0010's completed trip as "0 km"; Trips shows 2,617 km; odometer "Unknown" |
| AZS-20 | Minor | The audit log is empty although the system opened delay cases automatically |
| AZS-21 | Minor | The live map takes about 11 s to draw (style and fonts load late); it shows "Loading map…" until then |
| AZS-22 | Minor | Vehicle "Health 100 · Good" with no odometer, service or inspection data behind it |
| AZS-16 | Minor | Analytics "Deliveries 9" against 6 delivered shipments on Shipments (lots counted as deliveries without saying so) |

### AZS-01 · Major · Two identical "Delay" cases for the same lot
- **Where:** /cargo (Problems): EXC-V4RYQ9 and EXC-M3H9JM
- **Actual:** both "Delay · High · Open", created 18 hours ago, on RTX-94BD91A9-B · 1 pcs, unassigned.
- **Expected:** one open case per lot and type; a second detection updates the existing case.

### AZS-02 · Major · Delay cases stay open after delivery
- **Where:** /cargo, and Today shows "Open problems: 2 overdue"
- **Actual:** RTX-94BD91A9 shows "3 of 3 lots delivered", but both delay cases on lot B are still Open and "Overdue by 13 h 36 min".
- **Expected:** a delay case resolves itself (or at least stops counting as overdue) when the lot is delivered.

### AZS-03 · Major · Invoices show "Billed to: Not recorded"
- **Where:** /money?tab=invoices: INV-202609-0001 (₹1,50,000.04) and INV-202609-0002 (₹79,163)
- **Expected:** every invoice names the party billed (the customer or vendor, with GSTIN). A GST invoice without a recipient is not valid.

### AZS-04 · Minor · ₹1,50,000.04 total
- **Where:** INV-202609-0001
- **Actual:** the total carries 4 paise, which looks like a price entered including GST, split into base + 18% and rounded per line.

### AZS-05 · Minor · Trips can't be told apart
- **Where:** /routes. Nine rows show only the vehicle, status, stops and distance; there is no TR- number or shipment.

### AZS-06 · Minor · Completed and cancelled trips show plan figures
- **Where:** /routes, e.g. "Completed · 846.9 km · 21 h 25 min" for trips finished within hours, and "Cancelled · 0 stops · 1,849.5 km".

### AZS-07 · Minor · Names not trimmed
- **Where:** Today → "3 people are missing required documents: MUNNA, Vishal , admin".

### AZS-08 · Major · Delivery without a pickup
- **Where:** RTX-94BD91A9 drawer → Custody history: every lot shows "Picked up … Recorded with the delivery; no separate pickup was recorded", with the same time as the delivery.
- **Expected:** a driver records the pickup (count, condition) before driving. Delivering a stop whose goods were never picked up should be refused, or at least flagged to dispatch, because the pickup count is what proves a shortage.

### AZS-09 · Major · A split master tells staff to assign a vehicle
- **Where:** RTX-94BD91A9 drawer (Delivered, Split into lots): "Vehicle: Not assigned", "Driver: —", "Rate the driver: This delivery has no vehicle on record", "Assign a vehicle to message its driver", "Assign a vehicle to see where this shipment is".
- **Expected:** for a master, show the lots' vehicles and drivers (or "per lot, see below"), and offer rating and messages per lot.

### AZS-10 · Major · Delay cases opened after delivery
- **Where:** lot RTX-94BD91A9-B was delivered on 30 Sep at 6:59 pm. EXC-V4RYQ9 and EXC-M3H9JM (Delay) were created "18 hours ago", around 7:30 pm the same day.
- **Expected:** the delay check skips delivered, cancelled and returned lots, and does not open a second case for the same lot (AZS-01).

### AZS-11 · Minor · Master status history doesn't add up
- "Created" appears twice at 6:53 pm. "Delivery failed" appears at 6:59 pm (the same minute lot B was delivered), yet "Delivery attempts 0 of 3".

### AZS-12 · Gap · E-way bill not flagged
- Declared value ₹1,50,000; every lot shows "No e-way bill", and nothing warns before dispatch. An e-way bill is required for goods over ₹50,000 moved by road.

### AZS-13 · Minor · Master destination is a dash
- The drawer shows "Destination —"; the list shows "3 drops".

### AZS-14 · Major · Completed trips missing from driver pay
- **Where:** /money/driver-pay: 4 rows (TR-4AFB4EC7, TR-68BFF2BB, TR-2878581C, TR-DF2C1781, all MUNNA). /routes shows 7 completed trips, including DL01AL0010 (Vishal, 2,617 km) and JH10AL0303 at 1,617.8 km and 1,789.2 km.
- **Expected:** every completed trip has a pay entry, possibly ₹0 awaiting a rate. Check whether pay is only created for trips completed after the pay feature shipped; if so, backfill.

### AZS-15 · Major · Revenue "before GST" equals the invoice totals
- **Where:** /analytics: "Revenue ₹2,29,163 · 2 invoices, before GST". /money invoices: outstanding ₹2,29,163.04 (INV-0001 ₹1,50,000.04 + INV-0002 ₹79,163).
- **Expected:** either the invoices carry no GST (then say so) or revenue before GST is lower. One of the two screens is wrong.

### AZS-16 · Minor · Delivery counts differ
- /analytics "Deliveries 9 · Shipments marked delivered" against /shipments "Delivered 6". Lots are counted on one and not the other.

### AZS-17 · Major · Invoices issued with no seller details
- **Where:** /admin/settings → "Company and invoicing": company name, GSTIN, PAN and address are all empty, yet INV-202609-0001 and -0002 were issued.
- **Expected:** issuing an invoice is blocked (with a link to Settings) until the company name, GSTIN and state are set; the GSTIN decides CGST+SGST or IGST, so without it the tax split can't be right.

### AZS-18 · Major · Profit with no costs
- **Where:** /analytics → Costs ₹0 "No expenses in this range", Net profit ₹2,29,163, Profit per truck ₹1,14,582. /admin/settings: "Fuel price: Not set yet. Fuel is left out of costs".
- **Expected:** when the fuel price is unset or trips have no cost recorded, say so next to profit ("costs incomplete: fuel price not set, 7 trips without costs") instead of showing a clean profit.

### AZS-19 · Major · Vehicle trip distance and odometer
- **Where:** /fleet/c2ee743c-… (DL01AL0010) → Loads → Trips: "Completed · 0 km". /routes shows the same truck's completed trip at 2,617 km planned. Overview: "Odometer: Unknown".
- **Expected:** a completed trip shows its distance (actual if tracked, else planned, labelled) and moves the odometer. The 0 km may also explain why this trip has no driver-pay entry (AZS-14).

### AZS-20 · Minor · Audit log empty
- **Where:** /admin/audit, "Automated actions are recorded here": nothing in 30 days, although delay cases were opened automatically (AZS-01).

### AZS-21 · Minor · Slow live map
- **Where:** /live-map: "Loading map…" for about 11 s, then the map draws. The style, sprite and fonts all return 200.

### AZS-22 · Minor · Health score without inputs
- **Where:** vehicle Overview: "Health 100 · Good" while the odometer is unknown and there is no service or inspection record.
