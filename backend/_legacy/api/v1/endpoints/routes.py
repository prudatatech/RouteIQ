"""Route management endpoints."""
import uuid
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import joinedload, selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.models import Route, DeliveryPoint, RouteStop
from app.schemas.schemas import RouteResponse, TokenData, DeliveryPointResponse, RouteUpdate

router = APIRouter()


@router.get("/", response_model=List[RouteResponse])
async def list_routes(
    status: Optional[str] = Query(None),
    vehicle_id: Optional[uuid.UUID] = Query(None),
    skip: int = 0, limit: int = 50,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
):
    from app.models.models import Vehicle
    q = select(Route).options(
        joinedload(Route.vehicle), 
        selectinload(Route.stops).joinedload(RouteStop.delivery_point)
    )
    if token.role == "driver":
        q = q.join(Vehicle).where(Vehicle.driver_id == uuid.UUID(token.user_id))
    
    if status:
        q = q.where(Route.status == status)
    if vehicle_id:
        q = q.where(Route.vehicle_id == vehicle_id)
        
    q = q.order_by(Route.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/delivery-points", response_model=List[DeliveryPointResponse])
async def list_delivery_points(
    db: AsyncSession = Depends(get_db),
    _: TokenData = Depends(get_current_user),
):
    result = await db.execute(select(DeliveryPoint))
    return result.scalars().all()


@router.get("/{route_id}", response_model=RouteResponse)
async def get_route(
    route_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
):
    result = await db.execute(
        select(Route)
        .options(
            joinedload(Route.vehicle), 
            selectinload(Route.stops).joinedload(RouteStop.delivery_point)
        )
        .where(Route.id == route_id)
    )

    route = result.scalar_one_or_none()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
        
    if token.role == "driver" and route.vehicle.driver_id != uuid.UUID(token.user_id):
        raise HTTPException(status_code=403, detail="Not authorized to view this route")
        
    return route



@router.patch("/{route_id}/status")
async def update_route_status(
    route_id: uuid.UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
):
    result = await db.execute(select(Route).options(joinedload(Route.vehicle)).where(Route.id == route_id))
    route = result.scalar_one_or_none()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
    
    new_status = body.get("status")
    if new_status:
        route.status = new_status
        # Handle side effects on vehicle
        if new_status in ["in_progress", "active"]:
            route.vehicle.status = "on_route"
        elif new_status in ["completed", "cancelled"]:
            route.vehicle.status = "available"
            
    await db.flush()
    await db.commit()
    return {"id": str(route.id), "status": route.status, "vehicle_status": route.vehicle.status}


@router.post("/{route_id}/reroute")
async def apply_reroute(
    route_id: uuid.UUID,
    body: Dict[str, Any],
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
):
    """
    Applies a new stop sequence to an active route (Rerouting).
    """
    if token.role not in ["admin", "superadmin", "manager"]:
        raise HTTPException(status_code=403, detail="Not authorized to apply reroutes")
        
    new_sequence = body.get("new_sequence") # List of DP IDs
    if not new_sequence:
        raise HTTPException(status_code=400, detail="new_sequence is required")
        
    result = await db.execute(
        select(Route)
        .options(selectinload(Route.stops))
        .where(Route.id == route_id)
    )
    route = result.scalar_one_or_none()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
        
    # Re-sequence pending stops
    # Note: we only re-order stops that are still 'pending'
    stop_map = {str(s.delivery_point_id): s for s in route.stops if s.status == "pending"}
    
    for i, dp_id in enumerate(new_sequence):
        if dp_id in stop_map:
            stop_map[dp_id].sequence = i
            
    # Clear suggestions from cache for this vehicle
    from app.core.redis import cache_get, cache_set
    existing = await cache_get("active_reroute_suggestions") or []
    updated = [s for s in existing if s['vehicle_id'] != str(route.vehicle_id)]
    await cache_set("active_reroute_suggestions", updated, ttl=3600)
            
    await db.commit()
    return {"status": "rerouted", "route_id": str(route_id), "new_sequence_count": len(new_sequence)}


@router.patch("/{route_id}", response_model=RouteResponse)
async def update_route(
    route_id: uuid.UUID,
    body: RouteUpdate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
):
    if token.role not in ["admin", "superadmin", "manager"]:
        raise HTTPException(status_code=403, detail="Not authorized to edit routes")

    result = await db.execute(
        select(Route)
        .options(
            joinedload(Route.vehicle), 
            selectinload(Route.stops).joinedload(RouteStop.delivery_point)
        )
        .where(Route.id == route_id)
    )
    route = result.scalar_one_or_none()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
        
    if body.vehicle_id is not None:
        route.vehicle_id = body.vehicle_id
        
    if body.status is not None:
        route.status = body.status
        if body.status in ["active", "in_progress"]:
            if route.vehicle:
                route.vehicle.status = "on_route"
        elif body.status in ["completed", "cancelled"]:
            if route.vehicle:
                route.vehicle.status = "available"

    await db.commit()
    await db.refresh(route)
    return route


@router.delete("/{route_id}")
async def delete_route(
    route_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
):
    if token.role not in ["admin", "superadmin", "manager"]:
        raise HTTPException(status_code=403, detail="Not authorized to delete routes")

    result = await db.execute(select(Route).options(joinedload(Route.vehicle)).where(Route.id == route_id))
    route = result.scalar_one_or_none()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
        
    # Free up the vehicle
    if route.vehicle and route.vehicle.status == "on_route" and route.status in ["active", "pending"]:
        route.vehicle.status = "available"

    await db.delete(route)
    await db.commit()
    return {"detail": "Route deleted successfully"}

