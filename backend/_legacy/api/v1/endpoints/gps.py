from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.schemas.gps import GPSPointCreate, GPSPointRead
from app.services.gps_service import GPSService

router = APIRouter()

@router.post("/", response_model=GPSPointRead, status_code=status.HTTP_201_CREATED)
async def create_gps_point(
    payload: GPSPointCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    return await GPSService.create_point(db, payload)

@router.get("/vehicle/{vehicle_id}", response_model=list[GPSPointRead])
async def list_recent_points(
    vehicle_id: str,
    minutes: int = 5,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    return await GPSService.get_recent_points(db, vehicle_id, minutes)
