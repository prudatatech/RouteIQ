/**
 * margixindia — Unified API Router
 * Ports: backend/app/api/v1/router.py
 * 
 * Maps every prefix to its route handler — identical prefix structure to the Python backend
 * so the frontend doesn't need a single URL change.
 */
import { Router } from 'express';

import authRoutes from './auth.routes';
import usersRoutes from './users.routes';
import vehiclesRoutes from './vehicles.routes';
import shipmentsRoutes from './shipments.routes';
import routesRoutes from './routes.routes';
import optimizationRoutes from './optimization.routes';
import telemetryRoutes from './telemetry.routes';
import dashboardRoutes from './dashboard.routes';
import analyticsRoutes from './analytics.routes';
import depotsRoutes from './depots.routes';
import cargoRoutes from './cargo.routes';
import cargoCustodyRoutes from './cargo-custody.routes';
import gpsRoutes from './gps.routes';
import sparkGpsRoutes from './spark-gps.routes';
import marketplaceRoutes from './marketplace.routes';
import capacityRoutes from './capacity.routes';
import vendorRoutes from './vendor.routes';
import tplRoutes from './tpl.routes';
import tplNetworkRoutes from './tpl-network.routes';
import gstinRoutes from './gstin.routes';
import bankRoutes from './bank.routes';
import searchRoutes from './search.routes';
import notificationsRoutes from './notifications.routes';
import financeRoutes from './finance.routes';
import invoicesRoutes from './invoices.routes';
import driverPayRoutes from './driver-pay.routes';
import telematicsRoutes from './telematics.routes';
import fleetRoutes from './fleet.routes';
import fuelRoutes from './fuel.routes';
import pricingRoutes from './pricing.routes';
import trafficRoutes from './traffic.routes';
import routingRoutes from './routing.routes';
import weatherRoutes from './weather.routes';
import customerRoutes from './customer.routes';
import bookingsRoutes from './bookings.routes';
import publicRoutes from './public.routes';
import driverRoutes from './driver.routes';
import messagesRoutes from './messages.routes';
import peopleRoutes from './people.routes';
import opsRoutes from './ops.routes';
import loadDocumentsRoutes from './load-documents.routes';
import { adminOrgsRouter, orgRouter, orgsRouter, tplAffiliationsRouter } from './org.routes';

const apiRouter = Router();

// ── Mount all route modules ────────────────────────────────
// Prefix structure is IDENTICAL to Python backend's router.py
apiRouter.use('/auth', authRoutes);
apiRouter.use('/users', usersRoutes);
apiRouter.use('/vehicles', vehiclesRoutes);
apiRouter.use('/shipments', shipmentsRoutes);
apiRouter.use('/routes', routesRoutes);
apiRouter.use('/optimize', optimizationRoutes);
apiRouter.use('/telemetry', telemetryRoutes);
apiRouter.use('/dashboard', dashboardRoutes);
apiRouter.use('/analytics', analyticsRoutes);
apiRouter.use('/depots', depotsRoutes);
apiRouter.use('/cargo', cargoRoutes);
apiRouter.use('/cargo', cargoCustodyRoutes);
apiRouter.use('/gps', gpsRoutes);
apiRouter.use('/spark-gps', sparkGpsRoutes);
apiRouter.use('/marketplace', marketplaceRoutes);
apiRouter.use('/capacity', capacityRoutes);
apiRouter.use('/vendor', vendorRoutes);
apiRouter.use('/tpl/affiliations', tplAffiliationsRouter);
apiRouter.use('/tpl', tplRoutes);
apiRouter.use('/tpl-network', tplNetworkRoutes);
apiRouter.use('/gstin', gstinRoutes);
apiRouter.use('/bank', bankRoutes);
apiRouter.use('/search', searchRoutes);
apiRouter.use('/notifications', notificationsRoutes);
apiRouter.use('/finance', financeRoutes);
apiRouter.use('/invoices', invoicesRoutes);
apiRouter.use('/driver-pay', driverPayRoutes);
apiRouter.use('/telematics', telematicsRoutes);
apiRouter.use('/fleet', fleetRoutes);
apiRouter.use('/fleet', fuelRoutes);
apiRouter.use('/pricing', pricingRoutes);
apiRouter.use('/traffic', trafficRoutes);
apiRouter.use('/routing', routingRoutes);
apiRouter.use('/weather', weatherRoutes);
apiRouter.use('/customer', customerRoutes);
apiRouter.use('/bookings', bookingsRoutes);
apiRouter.use('/public', publicRoutes);
apiRouter.use('/driver', driverRoutes);
apiRouter.use('/messages', messagesRoutes);
apiRouter.use('/people', peopleRoutes);
apiRouter.use('/ops', opsRoutes);
apiRouter.use('/loads', loadDocumentsRoutes);
apiRouter.use('/orgs', orgsRouter);
apiRouter.use('/org', orgRouter);
apiRouter.use('/admin/orgs', adminOrgsRouter);

export default apiRouter;
