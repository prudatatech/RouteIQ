"""Depot management endpoints."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.models import Depot
from app.schemas.auth import TokenData

router = APIRouter()


@router.get("/")
async def list_depots(
    db: AsyncSession = Depends(get_db),
    _: TokenData = Depends(get_current_user),
):
    """List all depots."""
    result = await db.execute(select(Depot))
    depots = result.scalars().all()
    return [
        {
            "id": str(d.id),
            "name": d.name,
            "latitude": d.latitude,
            "longitude": d.longitude,
            "address": getattr(d, "address", ""),
        }
        for d in depots
    ]
