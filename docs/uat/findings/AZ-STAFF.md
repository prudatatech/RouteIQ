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
