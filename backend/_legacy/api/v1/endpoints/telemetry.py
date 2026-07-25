"""Telemetry endpoints — live GPS & vehicle data ingestion."""
import uuid
from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, Query, HTTPException, WebSocket
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.models import Telemetry, Vehicle, VehicleStoppage
from app.schemas.schemas import TelemetryCreate, TelemetryResponse, TokenData

router = APIRouter()


@router.post("/", response_model=TelemetryResponse, status_code=201)
async def ingest_telemetry(
    payload: TelemetryCreate,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
):
    from app.services.telemetry_service import TelemetryService
    
    try:
        t = await TelemetryService.ingest_telemetry(db, payload.model_dump())
        return t
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Telemetry Ingestion Failed: {str(e)}")


@router.websocket("/ws")
async def telemetry_websocket(websocket: WebSocket):
    from app.core.websocket import manager
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive
            await websocket.receive_text()
    except Exception:
        manager.disconnect(websocket)


@router.get("/{vehicle_id}/history", response_model=List[TelemetryResponse])
async def telemetry_history(
    vehicle_id: uuid.UUID,
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
):
    if token.role == "driver":
        # Check if vehicle belongs to driver
        v_result = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
        vehicle = v_result.scalar_one_or_none()
        if not vehicle or vehicle.driver_id != uuid.UUID(token.user_id):
            raise HTTPException(status_code=403, detail="Not authorized to view this history")

    result = await db.execute(
        select(Telemetry)
        .where(Telemetry.vehicle_id == vehicle_id)
        .order_by(desc(Telemetry.timestamp))
        .limit(limit)
    )
    return result.scalars().all()


@router.get("/{vehicle_id}/live")
async def live_position(
    vehicle_id: uuid.UUID, 
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user)
):
    if token.role == "driver":
        v_result = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
        vehicle = v_result.scalar_one_or_none()
        if not vehicle or vehicle.driver_id != uuid.UUID(token.user_id):
            raise HTTPException(status_code=403, detail="Not authorized to view live data")

    from app.core.redis import cache_get
    data = await cache_get(f"vehicle:live:{vehicle_id}")
    return data or {"error": "No live data available"}


@router.post("/stoppages", status_code=201)
async def log_stoppage(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
):
    """
    Log a driver-reported stoppage.
    Payload: { vehicle_id, lat, lng, reason }
    """
    if token.role != "driver":
        raise HTTPException(status_code=403, detail="Only drivers can report stoppages")

    stoppage = VehicleStoppage(
        vehicle_id=uuid.UUID(payload["vehicle_id"]),
        latitude=payload["lat"],
        longitude=payload["lng"],
        reason=payload.get("reason", "unknown"),
        start_time=datetime.now()
    )
    db.add(stoppage)
    await db.commit()
    return {"status": "stoppage_logged", "id": stoppage.id}


# ---------------------------------------------------------------------------
# Mobile Tracking — token-based, no auth required on push
# ---------------------------------------------------------------------------
# In-memory store for mobile sessions (keyed by token)
_mobile_sessions: dict = {}

@router.post("/mobile-session")
async def create_mobile_session(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    token: TokenData = Depends(get_current_user),
):
    """
    Create a shareable mobile GPS tracking session.
    Payload: { vehicle_id, phone (optional) }
    Returns: { token, tracking_url }
    """
    import secrets
    from app.core.websocket import manager
    import json

    vehicle_id = payload.get("vehicle_id")
    phone = payload.get("phone", "")

    if not vehicle_id:
        raise HTTPException(status_code=400, detail="vehicle_id is required")

    # Validate vehicle exists
    result = await db.execute(select(Vehicle).where(Vehicle.id == uuid.UUID(str(vehicle_id))))
    vehicle = result.scalar_one_or_none()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    session_token = secrets.token_urlsafe(16)
    _mobile_sessions[session_token] = {
        "vehicle_id": str(vehicle_id),
        "phone": phone,
        "plate": vehicle.plate_number,
        "created_at": datetime.now().isoformat(),
        "active": True,
    }

    return {
        "token": session_token,
        "vehicle_id": str(vehicle_id),
        "plate": vehicle.plate_number,
    }


@router.post("/mobile-push/{session_token}")
async def mobile_push_gps(
    session_token: str,
    payload: dict,
    db: AsyncSession = Depends(get_db),
):
    """
    No-auth GPS push endpoint for mobile browsers.
    Payload: { lat, lng, speed, accuracy, heading }
    """
    from app.services.telemetry_service import TelemetryService
    from app.core.websocket import manager
    import json

    session = _mobile_sessions.get(session_token)
    if not session or not session.get("active"):
        raise HTTPException(status_code=404, detail="Invalid or expired tracking session")

    vehicle_id = session["vehicle_id"]
    lat = payload.get("lat") or payload.get("latitude", 0)
    lng = payload.get("lng") or payload.get("longitude", 0)
    speed = payload.get("speed", 0) or 0
    heading = payload.get("heading", 0) or 0

    telemetry_data = {
        "vehicle_id": vehicle_id,
        "latitude": lat,
        "longitude": lng,
        "speed_kmph": round(speed * 3.6, 1) if speed else 0,  # m/s → km/h
        "heading": heading,
        "fuel_level_pct": 100.0,  # Not available from mobile
    }

    try:
        t = await TelemetryService.ingest_telemetry(db, telemetry_data)
        # Also broadcast via WebSocket
        await manager.broadcast(json.dumps({
            "type": "TELEMETRY_UPDATE",
            "data": {
                "vehicle_id": vehicle_id,
                "lat": lat,
                "lng": lng,
                "speed": telemetry_data["speed_kmph"],
                "source": "mobile",
            }
        }))
        return {"status": "ok", "vehicle_id": vehicle_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/mobile-session/{session_token}")
async def get_mobile_session(session_token: str):
    """Get session info (for mobile tracking page)."""
    session = _mobile_sessions.get(session_token)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session
