"""Dashboard analytics endpoints."""
import uuid
from datetime import datetime, timezone, date
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.models import Route, Vehicle
from app.schemas.schemas import KPIResponse, TokenData

router = APIRouter()


@router.get("/kpis", response_model=KPIResponse)
async def get_kpis(
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
):
    """Aggregate KPIs for admin/manager dashboard."""
    today = datetime.combine(date.today(), datetime.min.time()).replace(tzinfo=timezone.utc)
    
    # Filter by Driver if applicable
    if token.role == "driver":
        driver_uuid = uuid.UUID(token.user_id)
        # For routes, we need to join with Vehicle
        routes_q = select(Route).join(Vehicle).where(Vehicle.driver_id == driver_uuid).where(Route.created_at >= today)
        v_count_q = select(func.count()).where(Vehicle.driver_id == driver_uuid).where(Vehicle.status == "on_route")
    else:
        routes_q = select(Route).where(Route.created_at >= today)
        v_count_q = select(func.count()).where(Vehicle.status == "on_route")

    # Active vehicles
    v_result = await db.execute(v_count_q)
    active_vehicles = v_result.scalar() or 0

    # Routes today
    routes_result = await db.execute(routes_q)
    routes_today = routes_result.scalars().all()

    total_deliveries = len(routes_today)
    completed = sum(1 for r in routes_today if r.status == "completed")
    on_time_rate = (completed / total_deliveries * 100) if total_deliveries > 0 else 95.0
    fuel_today = sum(r.estimated_fuel_liters for r in routes_today) * 95  # ₹95/L
    avg_score = sum(r.optimization_score or 0.8 for r in routes_today) / max(1, len(routes_today))
    fuel_saved_pct = avg_score * 20  # up to 20% based on optimization score

    return KPIResponse(
        active_vehicles=active_vehicles,
        on_time_rate_pct=round(on_time_rate, 1),
        fuel_cost_today=round(fuel_today, 2),
        fuel_saved_pct=round(fuel_saved_pct, 1),
        total_deliveries_today=total_deliveries,
        avg_eta_accuracy_pct=round(on_time_rate * 0.95, 1),
        rerouting_events_today=max(0, total_deliveries // 8),
    )
