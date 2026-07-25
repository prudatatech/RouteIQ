from typing import Dict, Any
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.schemas.schemas import TokenData
from app.services.analytics_service import AnalyticsService

router = APIRouter()

@router.post("/event")
async def create_traffic_event(
    event_data: Dict[str, Any],
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user)
):
    """
    Simulates or ingests a real-time traffic event and triggers the reroute engine.
    Requires manager or admin role.
    """
    if token.role not in ["admin", "superadmin", "manager"]:
        raise HTTPException(status_code=403, detail="Not authorized to simulate traffic events")
        
    if "lat" not in event_data or "lng" not in event_data:
        raise HTTPException(status_code=400, detail="Latitude and Longitude are required")
        
    decisions = await AnalyticsService.process_traffic_event(db, event_data)
    
    return {
        "status": "processed",
        "event_type": event_data.get("event_type", "jam"),
        "reroute_suggestions_count": len(decisions),
        "decisions": [
            {
                "vehicle_id": d.vehicle_id,
                "saved_mins": d.saved_minutes,
                "trigger": d.trigger
            }
            for d in decisions
        ]
    }
