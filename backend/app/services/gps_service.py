from datetime import datetime, timedelta
from typing import List

from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import GPSPoint, Vehicle
from app.schemas.gps import GPSPointCreate

class GPSService:
    @staticmethod
    async def create_point(db: AsyncSession, payload: GPSPointCreate) -> GPSPoint:
        # Verify vehicle exists
        vehicle = await db.get(Vehicle, payload.vehicle_id)
        if not vehicle:
            raise ValueError(f"Vehicle with id {payload.vehicle_id} not found")
        point = GPSPoint(
            vehicle_id=payload.vehicle_id,
            latitude=payload.latitude,
            longitude=payload.longitude,
            accuracy=payload.accuracy,
            recorded_at=payload.recorded_at or datetime.utcnow(),
        )
        db.add(point)
        await db.commit()
        await db.refresh(point)
        return point

    @staticmethod
    async def get_recent_points(db: AsyncSession, vehicle_id: str, minutes: int = 5) -> List[GPSPoint]:
        cutoff = datetime.utcnow() - timedelta(minutes=minutes)
        stmt = (
            select(GPSPoint)
            .where(and_(GPSPoint.vehicle_id == vehicle_id, GPSPoint.recorded_at >= cutoff))
            .order_by(desc(GPSPoint.recorded_at))
        )
        result = await db.execute(stmt)
        return result.scalars().all()
