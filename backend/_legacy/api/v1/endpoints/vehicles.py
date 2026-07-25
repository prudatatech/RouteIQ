"""Vehicle management endpoints."""
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.redis import cache_get, cache_set
from app.core.security import get_current_user, require_role
from app.models.models import Vehicle
from app.schemas.schemas import TokenData, VehicleCreate, VehicleResponse, VehicleUpdate, FleetSummary

router = APIRouter()


@router.get("/", response_model=List[VehicleResponse])
async def list_vehicles(
    status: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
):
    cache_key = f"vehicles:list:{status}:{skip}:{limit}"
    cached = await cache_get(cache_key)
    if cached:
        return cached

    q = select(Vehicle)
    if token.role == "driver":
        q = q.where(Vehicle.driver_id == uuid.UUID(token.user_id))
    elif status:
        q = q.where(Vehicle.status == status)
        
    q = q.offset(skip).limit(limit)

    result = await db.execute(q)
    vehicles = result.scalars().all()
    
    data = [VehicleResponse.model_validate(v).model_dump(mode="json") for v in vehicles]
    await cache_set(cache_key, data, ttl=30)
    return data


@router.post("/", response_model=VehicleResponse, status_code=201)
async def create_vehicle(
    payload: VehicleCreate,
    db: AsyncSession = Depends(get_db),
    _: TokenData = Depends(require_role("admin", "manager")),
):
    vehicle = Vehicle(**payload.model_dump())
    db.add(vehicle)
    await db.flush()
    await db.refresh(vehicle)
    return vehicle


@router.get("/summary", response_model=FleetSummary)
async def fleet_summary(
    db: AsyncSession = Depends(get_db),
    _: TokenData = Depends(get_current_user),
):
    result = await db.execute(
        select(Vehicle.status, func.count()).group_by(Vehicle.status)
    )
    counts = dict(result.all())
    total = sum(counts.values())
    return FleetSummary(
        total=total,
        active=counts.get("on_route", 0),
        idle=counts.get("idle", 0) + counts.get("available", 0),
        maintenance=counts.get("maintenance", 0),
        offline=counts.get("offline", 0),
    )


@router.get("/{vehicle_id}", response_model=VehicleResponse)
async def get_vehicle(
    vehicle_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
):
    result = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
    vehicle = result.scalar_one_or_none()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
        
    if token.role == "driver" and vehicle.driver_id != uuid.UUID(token.user_id):
        raise HTTPException(status_code=403, detail="Not authorized to view this vehicle")
        
    return vehicle


@router.patch("/{vehicle_id}", response_model=VehicleResponse)
async def update_vehicle(
    vehicle_id: uuid.UUID,
    payload: VehicleUpdate,
    db: AsyncSession = Depends(get_db),
    _: TokenData = Depends(require_role("admin", "manager")),
):
    result = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
    vehicle = result.scalar_one_or_none()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(vehicle, field, value)

    await db.flush()
    await db.refresh(vehicle)
    return vehicle


@router.delete("/{vehicle_id}", status_code=204)
async def delete_vehicle(
    vehicle_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: TokenData = Depends(require_role("admin", "manager")),
):
    from sqlalchemy import delete
    from app.models.models import Route, Telemetry, MaintenanceAlert, VehicleStoppage, GPSPoint, RouteStop
    
    result = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
    vehicle = result.scalar_one_or_none()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
        
    # Delete dependent objects manually due to lack of ON DELETE CASCADE in DB schema
    routes_result = await db.execute(select(Route.id).where(Route.vehicle_id == vehicle_id))
    route_ids = routes_result.scalars().all()
    if route_ids:
        await db.execute(delete(RouteStop).where(RouteStop.route_id.in_(route_ids)))
        await db.execute(delete(Route).where(Route.id.in_(route_ids)))

    await db.execute(delete(Telemetry).where(Telemetry.vehicle_id == vehicle_id))
    await db.execute(delete(MaintenanceAlert).where(MaintenanceAlert.vehicle_id == vehicle_id))
    await db.execute(delete(VehicleStoppage).where(VehicleStoppage.vehicle_id == vehicle_id))
    await db.execute(delete(GPSPoint).where(GPSPoint.vehicle_id == vehicle_id))
    
    await db.delete(vehicle)
    await db.commit()
