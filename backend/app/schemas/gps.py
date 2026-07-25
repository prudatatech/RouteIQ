from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, validator

class GPSPointCreate(BaseModel):
    """Schema for incoming GPS point from mobile client."""
    vehicle_id: str = Field(..., description="UUID of the vehicle the point belongs to")
    latitude: float = Field(..., ge=-90.0, le=90.0, description="Latitude in decimal degrees")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="Longitude in decimal degrees")
    accuracy: Optional[float] = Field(None, gt=0, description="Horizontal accuracy in meters")
    recorded_at: Optional[datetime] = Field(None, description="Timestamp of the point; defaults to server time if omitted")

    @validator("recorded_at", pre=True, always=True)
    def default_timestamp(cls, v):
        return v or datetime.utcnow()

class GPSPointRead(BaseModel):
    id: str
    vehicle_id: str
    latitude: float
    longitude: float
    accuracy: Optional[float]
    recorded_at: datetime

    class Config:
        orm_mode = True
