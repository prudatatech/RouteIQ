-- Indexes for the queries the web app's main pages make on load (backend-ts).
--
-- Every index below serves a query that exists in backend-ts/src; the comment on each names it.
-- IF NOT EXISTS, no CONCURRENTLY: the runner wraps each file in a transaction and the tables are small.
-- Names are <table>_<columns>, like the indexes the earlier migrations created (idx_<table>_<columns>).

-- Shipments list and Dispatch: ShipmentService.listShipments
--   .from('shipments').order('created_at', desc).range(...)
CREATE INDEX IF NOT EXISTS idx_shipments_created_at ON public.shipments (created_at DESC);

-- Shipment counts, Today's "needs a vehicle", the open-loads marketplace:
--   routes/dashboard.routes.ts shipment-counts (one count per status), ops-today.service
--   .eq('status', 'created').neq('is_master', true), marketplace open-loads .eq('status','created').order('created_at', desc).limit(10)
CREATE INDEX IF NOT EXISTS idx_shipments_status_created_at ON public.shipments (status, created_at DESC);

-- Money, to price, and delivery analytics: finance.service getUnpricedDeliveries and analytics.service deliveryTimes
--   .from('shipments').in('status', ['delivered', ...]).gte('updated_at', ...).lt('updated_at', ...)
CREATE INDEX IF NOT EXISTS idx_shipments_status_updated_at ON public.shipments (status, updated_at);

-- Shipments list and shipment page: LIST_SHIPMENT_SELECT embeds parcels(*) and delivery_points(*) of every row
--   shipments?select=*,parcels(*),delivery_points!delivery_points_shipment_id_fkey(*,...)
CREATE INDEX IF NOT EXISTS idx_parcels_shipment ON public.parcels (shipment_id);
CREATE INDEX IF NOT EXISTS idx_delivery_points_shipment ON public.delivery_points (shipment_id);

-- Trips, shipment page, lots: .from('route_stops').in('delivery_point_id', ...)
--   shipment-overview.service tripOf, lot-carriers.ts, cargo/consignment.ts plannedVehicleOf, routes.routes.ts attachStopShipments
CREATE INDEX IF NOT EXISTS idx_route_stops_delivery_point ON public.route_stops (delivery_point_id);

-- Delivery analytics (Today insights, Analytics): analytics.service deliveryTimes
--   .from('shipment_logs').eq('status', 'delivered').gte('timestamp', ...).lt('timestamp', ...)
CREATE INDEX IF NOT EXISTS idx_shipment_logs_status_timestamp ON public.shipment_logs (status, "timestamp");

-- Shipments list / vendor loads: ShipmentService.listShipments, routes.routes.ts GET /
--   .from('cargo_manifest').order('created_at', desc).limit(n)
CREATE INDEX IF NOT EXISTS idx_cargo_manifest_created_at ON public.cargo_manifest (created_at DESC);

-- Money, to price, and delivery analytics: finance.service getUnpricedDeliveries, analytics.service deliveryTimes
--   .from('cargo_manifest').in('status', ['delivered', 'completed']).gte('updated_at', ...).lt('updated_at', ...)
CREATE INDEX IF NOT EXISTS idx_cargo_manifest_status_updated_at ON public.cargo_manifest (status, updated_at);

-- Trips (routes list), Today's trip counts and live strip, Dispatch "to send":
--   routes.routes.ts GET / .eq('status', ...).order('created_at', desc).range(...); ops-today.service
--   .eq('status', 'pending' | 'active' | 'completed').gte('created_at', today); vehicle-activity.ts .eq('status', 'active')
CREATE INDEX IF NOT EXISTS idx_routes_status_created_at ON public.routes (status, created_at DESC);

-- Trips list without a status filter: routes.routes.ts GET / .order('created_at', desc).range(...);
-- dashboard kpis and analytics .gte('created_at', today)
CREATE INDEX IF NOT EXISTS idx_routes_created_at ON public.routes (created_at DESC);

-- Every driver request: core/ownership.ts getDriverVehicleIds .from('vehicles').eq('driver_id', ...);
-- vehicles.routes.ts GET / for a driver. (vehicles_one_live_vehicle_per_driver is partial on status, so it cannot serve these.)
CREATE INDEX IF NOT EXISTS idx_vehicles_driver ON public.vehicles (driver_id) WHERE driver_id IS NOT NULL;

-- Fleet list, Today's live map, Trips: vehicles.routes.ts GET /
--   .from('vehicles').order('plate_number').order('id').range(skip, skip + limit - 1)
CREATE INDEX IF NOT EXISTS idx_vehicles_plate_id ON public.vehicles (plate_number, id);

-- Bell and Today's driver actions: notifications.routes.ts GET / (.eq('user_id', me).order('created_at', desc)),
-- the unread count (.eq('user_id', me).eq('is_read', false)) and ops-today.service driver actions
-- (.eq('user_id', me).eq('is_read', false).in('type', ...)). The browser reads the same rows directly.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications (user_id) WHERE is_read = false;

-- Fleet alerts: alerts.service listAlerts .from('maintenance_alerts').eq('is_resolved', false).order('created_at', desc).limit(200),
-- alertSummary .eq('is_resolved', false).eq('is_test', false) and .eq('is_test', false).gte('created_at', 30 days ago)
CREATE INDEX IF NOT EXISTS idx_maintenance_alerts_resolved_created_at ON public.maintenance_alerts (is_resolved, created_at DESC);

-- Money: invoices on a vendor load. shipment-overview.service and cargo notify .from('invoices').in('manifest_id', ...)
-- without a status filter, which the partial unique index invoices_one_per_manifest (status <> 'void') cannot serve.
CREATE INDEX IF NOT EXISTS idx_invoices_manifest ON public.invoices (manifest_id) WHERE manifest_id IS NOT NULL;

-- Today's requests queue and vendor load analytics:
--   ops-today.service .eq('status', 'pending') and .in('status', ['approved', 'escalated']);
--   analytics.service getFleetOverview .in('status', ['completed', 'assigned']).gte('created_at', ...).lt('created_at', ...)
CREATE INDEX IF NOT EXISTS idx_vendor_shipment_requests_status_created_at ON public.vendor_shipment_requests (status, created_at DESC);

-- Today's bids to decide: ops-today.service countBidsToDecide .from('capacity_bids').select('window_id').eq('status', 'pending')
CREATE INDEX IF NOT EXISTS idx_capacity_bids_pending ON public.capacity_bids (window_id) WHERE status = 'pending';

-- Shipments list: mapShipmentRows .from('capacity_windows').eq('trigger_type', 'superadmin_dispatch').in('fallback_shipment_id', ...)
CREATE INDEX IF NOT EXISTS idx_capacity_windows_fallback_shipment ON public.capacity_windows (fallback_shipment_id) WHERE fallback_shipment_id IS NOT NULL;

-- Today's documents to review: ops-today.service .from('user_documents').eq('status', 'pending').is('archived_at', null)
CREATE INDEX IF NOT EXISTS idx_user_documents_pending ON public.user_documents (status) WHERE archived_at IS NULL;

-- Today's KYC to review: ops-today.service .from('vendor_profiles').eq('kyc_status', 'submitted')
CREATE INDEX IF NOT EXISTS idx_vendor_profiles_kyc_status ON public.vendor_profiles (kyc_status);
