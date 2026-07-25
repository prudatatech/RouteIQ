"""Route optimization endpoints using VRP solver."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user, require_role
from app.ml.vrp_solver import Location, VehicleConfig, solve_vrp_ortools
from app.models.models import DeliveryPoint, Depot, Route, RouteStop, Vehicle
from app.schemas.schemas import (
    OptimizationRequest,
    OptimizationResponse,
    RouteResponse,
    RouteStopSchema,
    TokenData,
)
from app.ml.reroute_engine import reroute_engine
from app.core.redis import cache_get, cache_set


router = APIRouter()


@router.post("/", response_model=OptimizationResponse)
async def optimize_routes(
    payload: OptimizationRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(require_role("admin", "manager")),
):
    """
    1️⃣ Load depot, vehicles, delivery points
    2️⃣ Run OR-Tools VRP solver
    3️⃣ Save optimized routes
    4️⃣ Return optimized plan
    """

    # -----------------------------
    # Load depot
    # -----------------------------
    depot = None
    if payload.depot_id and str(payload.depot_id) != '00000000-0000-0000-0000-000000000001':
        depot_result = await db.execute(select(Depot).where(Depot.id == payload.depot_id))
        depot = depot_result.scalar_one_or_none()
        
        # If not a Depot, maybe it's a DeliveryPoint acting as origin/depot?
        if not depot:
            dp_result = await db.execute(select(DeliveryPoint).where(DeliveryPoint.id == payload.depot_id))
            dp_depot = dp_result.scalar_one_or_none()
            if dp_depot:
                # Mock a depot from the delivery point
                depot = Depot(id=dp_depot.id, name=dp_depot.name, latitude=dp_depot.latitude, longitude=dp_depot.longitude)
                
    if not depot:
        # Fallback to first depot if not found or not provided
        depot_result = await db.execute(select(Depot).limit(1))
        depot = depot_result.scalar_one_or_none()
        if not depot:
            raise HTTPException(status_code=400, detail="No depots configured in system. Please create a depot first.")

    # -----------------------------
    # Load vehicles
    # -----------------------------
    if payload.vehicle_ids:
        # Resolve any plate numbers in payload.vehicle_ids to UUIDs
        # (This handles cases where the frontend might pass a mix)
        v_res = await db.execute(select(Vehicle).where(
            Vehicle.id.in_(payload.vehicle_ids)
        ))
    else:
        # Include available, idle, AND on_route (for re-optimization)
        v_res = await db.execute(select(Vehicle).where(
            Vehicle.status.in_(["available", "idle", "on_route"])
        ).limit(20))
    
    vehicles = v_res.scalars().all()
    if not vehicles:
        raise HTTPException(
            status_code=400, 
            detail="Optimization Failed: No available vehicles found. Please ensure at least one vehicle is 'available', 'idle', or 'on_route'."
        )

    # -----------------------------
    # Load delivery points
    # -----------------------------
    if payload.delivery_point_ids:
        dp_result = await db.execute(select(DeliveryPoint).where(DeliveryPoint.id.in_(payload.delivery_point_ids)))
    else:
        dp_result = await db.execute(select(DeliveryPoint).where(DeliveryPoint.status == "pending").limit(100))
    delivery_points = dp_result.scalars().all()
    if not delivery_points:
        raise HTTPException(status_code=400, detail="Optimization Failed: No pending delivery points found. Please ensure you have shipments ready for delivery.")


    # -----------------------------
    # Build solver input
    # -----------------------------
    depot_loc = Location(
        id=str(depot.id),
        lat=depot.latitude,
        lng=depot.longitude,
    )

    locations = [depot_loc]

    for dp in delivery_points:
        locations.append(
            Location(
                id=str(dp.id),
                lat=dp.latitude,
                lng=dp.longitude,
                demand_kg=dp.demand_kg,
                required_cargo_types=getattr(dp, "required_cargo_types", []) or [],
                time_window_start=getattr(dp, "time_window_start", 0) or 0,
                time_window_end=getattr(dp, "time_window_end", 1440) or 1440,
                service_time=dp.service_time_minutes,
            )
        )

    vehicle_configs = [
        VehicleConfig(
            id=str(v.id),
            capacity_kg=v.capacity_kg,
            start_location=depot_loc,
            supported_cargo_types=getattr(v, "cargo_types", []) or [],
            fuel_efficiency_kmpl=v.fuel_efficiency_kmpl,
        )
        for v in vehicles
    ]

    # -----------------------------
    # Run VRP solver
    # -----------------------------
    solution = solve_vrp_ortools(
        locations=locations,
        vehicles=vehicle_configs,
        max_solve_seconds=payload.max_solve_time_seconds,
        traffic_factor=1.0 + (payload.traffic_density * settings.TRAFFIC_FACTOR_MULTIPLIER) if payload.consider_traffic else 1.0,
        weather_factor=1.0 + (payload.weather_severity * settings.WEATHER_FACTOR_MULTIPLIER) if payload.consider_weather else 1.0,
    )

    route_responses = []

    # -----------------------------
    # Save routes to DB
    # -----------------------------
    for opt_route in solution.routes:
        if not opt_route.stop_ids:
            continue

        route = Route(
            vehicle_id=uuid.UUID(opt_route.vehicle_id),
            depot_id=depot.id,
            status="pending",
            total_distance_km=opt_route.total_distance_km,
            total_duration_minutes=opt_route.total_duration_minutes,
            estimated_fuel_liters=opt_route.estimated_fuel_liters,
            weather_condition=opt_route.weather_condition,
            traffic_delay_minutes=opt_route.traffic_delay_minutes,

            # ✅ REQUIRED FIELDS FOR DB
            waypoints=[],   # ensures NOT NULL constraint is met
            optimization_score=float(opt_route.efficiency_score or 0.0),
        )

        db.add(route)
        await db.flush()   # ensures route.id is available

        route_stops = []
        # Save stops
        for seq, stop_id in enumerate(opt_route.stop_ids):
            # Resolve stop_id (it's a string from opt_route)
            sid = uuid.UUID(stop_id) if isinstance(stop_id, str) else stop_id
            
            stop = RouteStop(
                route_id=route.id,
                delivery_point_id=sid,
                sequence=seq,
                status="pending"
            )
            db.add(stop)
            
            # Add to response list
            route_stops.append(
                RouteStopSchema(
                    delivery_point_id=sid,
                    sequence=seq,
                    status="pending"
                )
            )

        # Build API response
        route_responses.append(
            RouteResponse(
                id=route.id,
                vehicle_id=route.vehicle_id,
                status=route.status,
                total_distance_km=route.total_distance_km,
                total_duration_minutes=route.total_duration_minutes,
                estimated_fuel_liters=route.estimated_fuel_liters,
                optimization_score=route.optimization_score,
                waypoints=route.waypoints,
                stops=route_stops,   # Populate stops
                created_at=datetime.now(timezone.utc),
            )
        )

    # -----------------------------
    # Return response
    # -----------------------------
    return OptimizationResponse(
        job_id=str(uuid.uuid4()),
        status="completed",
        routes=route_responses,
        total_distance_km=solution.total_distance_km,
        total_fuel_liters=solution.total_fuel_liters,
        estimated_savings_pct=solution.savings_vs_naive_pct,
        solve_time_seconds=solution.solve_time_seconds,
        message=f"Optimized {len(route_responses)} routes in {solution.solve_time_seconds:.2f}s",
    )


# ------------------------------------------------------------------
# ETA prediction endpoint
# ------------------------------------------------------------------
@router.post("/eta")
async def predict_eta(
    payload: dict,
    _: TokenData = Depends(get_current_user),
):
    """Quick ETA prediction."""
    from app.ml.eta_model import eta_predictor

    return eta_predictor.predict(
        distance_km=payload.get("distance_km", 10),
        traffic_density=payload.get("traffic_density", 0.5),
        weather_severity=payload.get("weather_severity", 0.0),
        vehicle_type=payload.get("vehicle_type", "truck"),
    )
@router.post("/incubate/{vehicle_id}")
async def incubate_routing(
    vehicle_id: str,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user)
):
    if token.role not in ["admin", "superadmin", "manager"]:
        raise HTTPException(status_code=403, detail="Not authorized to incubate routing")
        
    # Resolve vehicle_id (manual_scan handles both UUID and Plate Number)
    decision = await reroute_engine.manual_scan(db, str(vehicle_id))
    
    if not decision:
        return {
            "status": "checked", 
            "message": "No better route found at this time. Current path is already optimized based on live traffic."
        }
        
    existing = await cache_get("active_reroute_suggestions") or []
    new_suggestion = {
        "vehicle_id": decision.vehicle_id,
        "route_id": decision.route_id,
        "trigger": decision.trigger,
        "saved_minutes": decision.saved_minutes,
        "new_stop_sequence": decision.new_stop_sequence
    }
    
    combined = [new_suggestion] + [s for s in existing if s['vehicle_id'] != decision.vehicle_id]
    await cache_set("active_reroute_suggestions", combined, ttl=3600)
    
    return {
        "status": "suggested",
        "saved_minutes": decision.saved_minutes,
        "trigger": decision.trigger,
        "message": "AI Incubator found a better path! Saving ~{0} mins.".format(decision.saved_minutes)
    }
