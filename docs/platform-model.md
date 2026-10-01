# Platform model: actors and responsibilities

MargixIndia is a **logistics SaaS ecosystem**, not a single company's logistics system. It connects
vendors who need transport, logistic companies who run transport, and 3PL partners who add capacity to
those companies. We (the platform owner) run the platform, not the logistics. Decided on 1 Oct 2026.

## Actors

| Actor | Who | Owns and manages | Dashboard |
|---|---|---|---|
| **Vendor** | a business owner who ships goods (today's "vendors" and "customers" merge into this) | products (later, through the Inventory app), shipping orders, shipments, tracking, bids on spare space, payments, claims | vendor web dashboard + vendor mobile app (today's customer app) |
| **Logistic company** | a registered logistics partner, the operator | its fleet, drivers and their documents, vehicle documents and compliance, warehouses and cargo houses, cargo operations, routes and availability, the orders it takes from vendors, its 3PL partners | company dashboard (today's staff app, scoped to the company) |
| **3PL partner** | a small transport provider with a few vehicles | its vehicles and drivers; the work a company gives it | 3PL dashboard |
| **Platform admin** (Admin, Super Admin) | us, the SaaS owner | organisations, users, approvals, configuration, commissions, platform-wide oversight; **no day-to-day logistics** | admin console |
| **Driver** | works for a logistic company or a 3PL partner | the trips given to them | driver app |

## How work flows

1. **Order placement.** A vendor places a shipping order and either **sends it to chosen logistic
   companies** or **posts it open** to every company that serves the lane (vehicle type, capacity).
   Companies quote or accept; the vendor picks one. The accepted order belongs to that company.
2. **Spare space.** A company's vehicles publish unused capacity on their route. Vendors bid on it, from
   any company; the company awards a bid, which becomes an order on that vehicle.
3. **Execution.** The company plans and dispatches the order on its own vehicle, or **hands it to one of
   its 3PL partners** when it has no vehicle free. The company stays responsible to the vendor.
4. **3PL network.** A 3PL partner registers with one **or several** logistic companies (each must
   approve). A company sees and manages its partners, and offers them work when they have a vehicle free.
5. **Money.** The logistic company invoices the vendor (its own GSTIN). The platform earns a
   **commission per completed order** from the company; commissions are recorded per order and
   settled with each company.

## Data rules

- Every operational record (vehicle, driver, warehouse, order, shipment, trip, load, invoice, problem,
  transfer, driver pay, settings) **belongs to one organisation**. Database security rules guarantee an
  organisation sees only its own records, plus what is shared on purpose (an order a vendor sent it, a
  3PL job a company offered).
- A vendor sees its own orders across every company it works with.
- A 3PL partner sees each company's work separately.
- Platform admins see everything, read-mostly, for support and oversight.

## Later

- **Inventory app integration.** Vendors create shipping orders from the Inventory Management app through
  a vendor API key and webhooks for status. Planned, not part of the first build.
