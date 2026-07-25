import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query
from app.core.database import get_db
from app.schemas.schemas import ShipmentCreate, ShipmentResponse
from app.services.shipment_service import ShipmentService
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.security import get_current_user, require_role
from app.schemas.auth import TokenData

router = APIRouter()

@router.post("/", response_model=ShipmentResponse)
async def create_shipment(
    *,
    db: AsyncSession = Depends(get_db),
    shipment_in: ShipmentCreate,
    _: TokenData = Depends(require_role("admin", "manager"))
):
    """
    Create a new shipment with parcels.
    """
    return await ShipmentService.create_shipment(db, shipment_in)

@router.get("/", response_model=List[ShipmentResponse])
async def read_shipments(
    db: AsyncSession = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
    _: TokenData = Depends(get_current_user)
):
    """
    Retrieve shipments.
    """
    return await ShipmentService.list_shipments(db, skip=skip, limit=limit)

@router.get("/track/{tracking_id}")
async def public_track_shipment(
    tracking_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Publicly track a shipment by its tracking_id (no auth required).
    """
    info = await ShipmentService.get_public_tracking(db, tracking_id)
    if not info:
        raise HTTPException(status_code=404, detail="Shipment with this tracking ID not found")
    return info

@router.get("/{shipment_id}", response_model=ShipmentResponse)
async def read_shipment(
    shipment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: TokenData = Depends(get_current_user)
):
    """
    Get shipment by ID.
    """
    shipment = await ShipmentService.get_shipment(db, shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    return shipment

@router.patch("/{shipment_id}")
@router.patch("/{shipment_id}/", response_model=ShipmentResponse)
async def update_shipment_status(
    shipment_id: uuid.UUID,
    status: str = Query(..., pattern="^(created|picked_up|in_transit|delivered|cancelled)$"),
    lat: float = Query(None),
    lng: float = Query(None),
    received_by: str = Query(None),
    signature_data: str = Query(None),
    db: AsyncSession = Depends(get_db),
    _: TokenData = Depends(get_current_user)
):
    """
    Update shipment status with optional location coordinates and POD data.
    """
    shipment = await ShipmentService.update_shipment_status(
        db, shipment_id, status, lat, lng, received_by, signature_data
    )
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    return shipment

@router.get("/{shipment_id}/verify")
async def verify_shipment_integrity(
    shipment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db)
):
    """
    Verify the cryptographic hash chain of a shipment's logs.
    """
    from app.services.security_service import SecurityService
    shipment = await ShipmentService.get_shipment(db, shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    
    is_valid = SecurityService.verify_chain(shipment.logs)
    return {
        "shipment_id": shipment_id,
        "is_valid": is_valid,
        "log_count": len(shipment.logs),
        "last_status": shipment.status
    }

@router.delete("/{shipment_id}")
@router.delete("/{shipment_id}/")
async def delete_shipment(
    shipment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: TokenData = Depends(require_role("admin", "manager"))
):
    """
    Delete a shipment.
    """
    success = await ShipmentService.delete_shipment(db, shipment_id)
    if not success:
        raise HTTPException(status_code=404, detail="Shipment not found")
    return {"message": "Shipment deleted successfully"}

@router.patch("/{shipment_id}/edit")
@router.patch("/{shipment_id}/edit/", response_model=ShipmentResponse)
async def edit_shipment(
    shipment_id: uuid.UUID,
    update_data: dict,
    db: AsyncSession = Depends(get_db),
    _: TokenData = Depends(require_role("admin", "manager"))
):
    """
    Update specific shipment properties.
    """
    shipment = await ShipmentService.update_shipment(db, shipment_id, update_data)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    return shipment
