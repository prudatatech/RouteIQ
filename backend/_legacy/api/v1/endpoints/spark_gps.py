from fastapi import APIRouter, Depends, HTTPException, status
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models.models import Vehicle, GPSPoint

router = APIRouter()

@router.post("/", status_code=status.HTTP_201_CREATED)
async def receive_spark_gps(payload: dict, db: AsyncSession = Depends(get_db)):
    """Endpoint for Spark Push API to ingest GPS data.
    Expected payload keys (example):
        deviceId, imei, vehicleNo, lat, lng, speed, timestamp
    """
    vehicle_no = payload.get("vehicleNo")
    if not vehicle_no:
        raise HTTPException(status_code=400, detail="vehicleNo missing")
    # Find vehicle by plate number (or you could also use spark_id if stored)
    result = await db.execute(select(Vehicle).where(Vehicle.plate_number == vehicle_no))
    vehicle = result.scalar_one_or_none()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    lat = payload.get("lat")
    lng = payload.get("lng")
    if lat is None or lng is None:
        raise HTTPException(status_code=400, detail="lat/lng missing")

    point = GPSPoint(
        vehicle_id=vehicle.id,
        latitude=lat,
        longitude=lng,
        accuracy=None,
        recorded_at=payload.get("timestamp") or datetime.utcnow(),
    )
    db.add(point)
    await db.commit()
    await db.refresh(point)
    return {"status": "success", "gps_point_id": str(point.id)}
