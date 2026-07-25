"""API v1 router — aggregates all endpoint routers.

NOTE: 13 endpoint modules (auth, users, vehicles, shipments, routes, telemetry,
dashboard, analytics, traffic, depots, cargo, gps, spark_gps) have been migrated
to the TypeScript backend (backend-ts/) and moved to backend/_legacy/.
Only supabase_auth, optimization, and agents remain active here.
"""
from fastapi import APIRouter

from .endpoints import optimization, supabase_auth, agents

api_router = APIRouter()

# --- Still active in Python (not yet migrated to TS) ---
api_router.include_router(optimization.router, prefix="/optimize",     tags=["Optimization"])
api_router.include_router(agents.router,       prefix="/agents",       tags=["AI Agents"])
