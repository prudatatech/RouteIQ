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
import trafficRoutes from './traffic.routes';
import depotsRoutes from './depots.routes';
import cargoRoutes from './cargo.routes';
import gpsRoutes from './gps.routes';
import sparkGpsRoutes from './spark-gps.routes';
import marketplaceRoutes from './marketplace.routes';
import capacityRoutes from './capacity.routes';
import vendorRoutes from './vendor.routes';

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
apiRouter.use('/traffic', trafficRoutes);
apiRouter.use('/depots', depotsRoutes);
apiRouter.use('/cargo', cargoRoutes);
apiRouter.use('/gps', gpsRoutes);
apiRouter.use('/spark-gps', sparkGpsRoutes);
apiRouter.use('/marketplace', marketplaceRoutes);
apiRouter.use('/capacity', capacityRoutes);
apiRouter.use('/vendor', vendorRoutes);

export default apiRouter;
