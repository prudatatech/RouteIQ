"""
RouteIQ ML Microservice — Standalone FastAPI
Runs on port 8001. Called by the TS backend for:
  - VRP route optimization (Google OR-Tools)
  - ETA prediction (XGBoost / physics-based)
  - Dynamic reroute evaluation

DB: Supabase (no SQLAlchemy). Only reads route/vehicle/telemetry data.
Deploy: Railway (separate service)
"""
from __future__ import annotations

import os
import logging
import math
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client, Client

# ── Logging ──────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger("routeiq.ml")

# ── Supabase ─────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

supabase: Optional[Client] = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    logger.info("Supabase connected")
else:
    logger.warning("Supabase credentials not set — DB queries will be unavailable")

# ── Import ML modules (from same directory) ──────────────────
from ml.vrp_solver import Location, VehicleConfig, solve_vrp_ortools, OptimizedRoute, VRPSolution
from ml.eta_model import eta_predictor
from ml.bin_packer import bin_pack

# ── FastAPI App ──────────────────────────────────────────────
app = FastAPI(title="RouteIQ ML Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Schemas ──────────────────────────────────────────────────

class LocationInput(BaseModel):
    id: str
    lat: float
    lng: float
    demand_kg: float = 0.0
    required_cargo_types: List[str] = []
    time_window_start: int = 0
    time_window_end: int = 1440
    service_time: int = 10

class VehicleInput(BaseModel):
    id: str
    capacity_kg: float
    start_lat: float
    start_lng: float
    supported_cargo_types: List[str] = []
    fuel_efficiency_kmpl: float = 10.0

class OptimizeRequest(BaseModel):
    locations: List[LocationInput]
    vehicles: List[VehicleInput]
    max_solve_seconds: int = 30
    traffic_factor: float = 1.0
    weather_factor: float = 1.0
    blockages: List[List[int]] = []

class ETARequest(BaseModel):
    distance_km: float
    traffic_density: float = 0.5
    weather_severity: float = 0.0
    vehicle_type: str = "truck"
    historical_avg_speed_kmph: float = 45.0

class RerouteRequest(BaseModel):
    vehicle_id: str

class BinPackRequest(BaseModel):
    items: List[Dict[str, Any]]
    bin_capacity: float


# ── Routes ───────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "routeiq-ml", "version": "1.0.0"}


@app.post("/optimize")
async def optimize(req: OptimizeRequest):
    """Run VRP optimization using Google OR-Tools."""
    try:
        locations = [
            Location(
                id=loc.id,
                lat=loc.lat,
                lng=loc.lng,
                demand_kg=loc.demand_kg,
                required_cargo_types=loc.required_cargo_types,
                time_window_start=loc.time_window_start,
                time_window_end=loc.time_window_end,
                service_time=loc.service_time,
            )
            for loc in req.locations
        ]
        vehicles = [
            VehicleConfig(
                id=v.id,
                capacity_kg=v.capacity_kg,
                start_location=Location(id=f"depot_{v.id}", lat=v.start_lat, lng=v.start_lng),
                supported_cargo_types=v.supported_cargo_types,
                fuel_efficiency_kmpl=v.fuel_efficiency_kmpl,
            )
            for v in req.vehicles
        ]

        solution = solve_vrp_ortools(
            locations=locations,
            vehicles=vehicles,
            max_solve_seconds=req.max_solve_seconds,
            traffic_factor=req.traffic_factor,
            weather_factor=req.weather_factor,
            blockages=[(b[0], b[1]) for b in req.blockages if len(b) == 2],
        )

        return {
            "routes": [
                {
                    "vehicle_id": r.vehicle_id,
                    "stop_ids": r.stop_ids,
                    "total_distance_km": r.total_distance_km,
                    "total_duration_minutes": r.total_duration_minutes,
                    "estimated_fuel_liters": r.estimated_fuel_liters,
                    "traffic_delay_minutes": r.traffic_delay_minutes,
                    "weather_condition": r.weather_condition,
                    "efficiency_score": r.efficiency_score,
                }
                for r in solution.routes
            ],
            "total_distance_km": solution.total_distance_km,
            "total_fuel_liters": solution.total_fuel_liters,
            "solve_time_seconds": solution.solve_time_seconds,
            "savings_vs_naive_pct": solution.savings_vs_naive_pct,
            "solver_status": solution.solver_status,
        }
    except Exception as e:
        logger.error(f"Optimization failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/predict-eta")
async def predict_eta(req: ETARequest):
    """Predict delivery ETA using XGBoost or physics-based fallback."""
    try:
        result = eta_predictor.predict(
            distance_km=req.distance_km,
            traffic_density=req.traffic_density,
            weather_severity=req.weather_severity,
            vehicle_type=req.vehicle_type,
            historical_avg_speed_kmph=req.historical_avg_speed_kmph,
        )
        return result
    except Exception as e:
        logger.error(f"ETA prediction failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/evaluate-reroute")
async def evaluate_reroute(req: RerouteRequest):
    """
    Evaluate whether a vehicle should be rerouted.
    Reads current route + telemetry from Supabase, runs VRP solver on remaining stops.
    """
    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase not configured")

    try:
        vehicle_id = req.vehicle_id

        # 1. Find active route for this vehicle
        route_res = supabase.from_("routes").select(
            "id, status, vehicle_id, total_duration_minutes"
        ).eq("vehicle_id", vehicle_id).in_("status", ["active", "pending"]).execute()

        routes = route_res.data or []
        if not routes:
            return {"saved_minutes": 0, "message": "No active route found"}

        route = routes[0]

        # 2. Get pending stops with delivery points
        stops_res = supabase.from_("route_stops").select(
            "id, sequence, status, delivery_point_id, delivery_points(id, latitude, longitude, demand_kg)"
        ).eq("route_id", route["id"]).eq("status", "pending").order("sequence").execute()

        pending_stops = stops_res.data or []
        if len(pending_stops) < 2:
            return {"saved_minutes": 0, "message": "Too few remaining stops to optimize"}

        # 3. Get latest telemetry for start position
        tele_res = supabase.from_("telemetry").select(
            "latitude, longitude, speed_kmph"
        ).eq("vehicle_id", vehicle_id).order("timestamp", desc=True).limit(1).execute()

        tele = tele_res.data[0] if tele_res.data else None
        start_lat = tele["latitude"] if tele else pending_stops[0]["delivery_points"]["latitude"]
        start_lng = tele["longitude"] if tele else pending_stops[0]["delivery_points"]["longitude"]

        # 4. Build locations for solver
        start_loc = Location(id=vehicle_id, lat=start_lat, lng=start_lng)
        locations = [start_loc] + [
            Location(
                id=str(s["delivery_point_id"]),
                lat=s["delivery_points"]["latitude"],
                lng=s["delivery_points"]["longitude"],
                demand_kg=s["delivery_points"].get("demand_kg", 0),
            )
            for s in pending_stops
        ]

        # 5. Solve
        solution = solve_vrp_ortools(
            locations=locations,
            vehicles=[VehicleConfig(id=vehicle_id, capacity_kg=9999, start_location=start_loc)],
            max_solve_seconds=5,
            traffic_factor=1.1,  # assume slight traffic
        )

        if not solution.routes:
            return {"saved_minutes": 0, "message": "Solver returned no routes"}

        new_route = solution.routes[0]
        old_eta = route.get("total_duration_minutes", 0) or 0
        saved = round(old_eta - new_route.total_duration_minutes, 1)

        if saved < 5:
            return {"saved_minutes": 0, "message": f"Reroute saves only {saved} mins (below threshold)"}

        # Determine trigger message
        trigger = "Heuristic route efficiency scan"
        if tele and tele.get("speed_kmph", 0) < 5:
            trigger = "Detected stationary vehicle on active route"

        return {
            "vehicle_id": vehicle_id,
            "route_id": route["id"],
            "trigger": trigger,
            "saved_minutes": saved,
            "new_stop_sequence": new_route.stop_ids,
            "old_eta_minutes": old_eta,
            "new_eta_minutes": new_route.total_duration_minutes,
        }
    except Exception as e:
        logger.error(f"Reroute evaluation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/bin-pack")
async def bin_pack_endpoint(req: BinPackRequest):
    """Bin packing for cargo space optimization."""
    try:
        result = bin_pack(req.items, req.bin_capacity)
        return result
    except Exception as e:
        logger.error(f"Bin packing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Run ──────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8001"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
