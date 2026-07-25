"""Pydantic schemas for request/response validation."""
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any, List, Optional
from pydantic import BaseModel, EmailStr, Field, ConfigDict


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
class TokenData(BaseModel):
    user_id: str
    role: str = "driver"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: str
    user_id: uuid.UUID



class RefreshRequest(BaseModel):
    refresh_token: str


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------
class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=255)
    password: str = Field(min_length=8)
    role: str = Field(default="driver", pattern="^(superadmin|admin|manager|driver)$")


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: str
    full_name: str
    role: str
    is_active: bool
    created_at: datetime


# ---------------------------------------------------------------------------
# Vehicles
# ---------------------------------------------------------------------------
class VehicleCreate(BaseModel):
    plate_number: str = Field(min_length=4, max_length=20)
    vehicle_type: str = Field(pattern="^(truck|van|bike|car)$")
    capacity_kg: float = Field(gt=0, le=50000)
    fuel_type: str = "diesel"
    fuel_capacity_liters: float = Field(gt=0, le=1000, default=60.0)
    fuel_efficiency_kmpl: float = Field(gt=0, le=100, default=12.0)
    spark_id: Optional[str] = Field(None, max_length=50)


class VehicleUpdate(BaseModel):
    plate_number: Optional[str] = Field(None, min_length=4, max_length=20)
    vehicle_type: Optional[str] = Field(None, pattern="^(truck|van|bike|car)$")
    capacity_kg: Optional[float] = Field(None, gt=0, le=50000)
    fuel_type: Optional[str] = None
    fuel_capacity_liters: Optional[float] = Field(None, gt=0, le=1000)
    fuel_efficiency_kmpl: Optional[float] = Field(None, gt=0, le=100)
    spark_id: Optional[str] = Field(None, max_length=50)
    status: Optional[str] = Field(None, pattern="^(available|on_route|idle|maintenance|offline)$")
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    driver_id: Optional[uuid.UUID] = None


class VehicleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    plate_number: str
    vehicle_type: str
    capacity_kg: float
    status: str
    fuel_type: Optional[str] = None
    fuel_capacity_liters: Optional[float] = None
    fuel_efficiency_kmpl: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    driver_id: Optional[uuid.UUID] = None
    spark_id: Optional[str] = None
    last_sync: Optional[datetime] = None
    created_at: datetime


# ---------------------------------------------------------------------------
# Route Optimization
# ---------------------------------------------------------------------------
class DeliveryPointResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    address: str
    latitude: float
    longitude: float
    demand_kg: float
    status: str
    shipment_id: Optional[uuid.UUID] = None


class OptimizationRequest(BaseModel):
    depot_id: Optional[uuid.UUID] = None
    vehicle_ids: List[uuid.UUID] = Field(min_length=0, max_length=100, default_factory=list)
    delivery_point_ids: List[uuid.UUID] = Field(min_length=0, max_length=500, default_factory=list)
    algorithm: str = Field(default="ortools", pattern="^(ortools|genetic|reinforcement)$")
    consider_traffic: bool = True
    consider_weather: bool = True
    traffic_density: float = Field(default=0.5, ge=0, le=1)
    weather_severity: float = Field(default=0.0, ge=0, le=1)
    max_solve_time_seconds: int = Field(default=30, ge=5, le=300)


class RouteStopSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    delivery_point_id: uuid.UUID
    sequence: int
    status: str
    delivery_point: Optional[DeliveryPointResponse] = None



class RouteUpdate(BaseModel):
    vehicle_id: Optional[uuid.UUID] = None
    status: Optional[str] = Field(None, pattern="^(pending|optimizing|active|completed|cancelled)$")

class RouteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    vehicle_id: uuid.UUID
    status: str
    total_distance_km: float
    total_duration_minutes: float
    estimated_fuel_liters: float
    weather_condition: str = "clear"
    traffic_delay_minutes: int = 0
    optimization_score: Optional[float] = None
    waypoints: List[Any]
    stops: List[RouteStopSchema] = []
    created_at: datetime


class OptimizationResponse(BaseModel):
    job_id: str
    status: str = "queued"
    routes: List[RouteResponse] = []
    total_distance_km: float = 0
    total_fuel_liters: float = 0
    estimated_savings_pct: float = 0
    solve_time_seconds: Optional[float] = None
    message: str = ""


# ---------------------------------------------------------------------------
# ETA Prediction
# ---------------------------------------------------------------------------
class ETARequest(BaseModel):
    vehicle_id: uuid.UUID
    origin_lat: float = Field(ge=-90, le=90)
    origin_lng: float = Field(ge=-180, le=180)
    destination_lat: float = Field(ge=-90, le=90)
    destination_lng: float = Field(ge=-180, le=180)
    distance_km: float = Field(gt=0)
    current_traffic_density: float = Field(ge=0, le=1, default=0.5)


class ETAResponse(BaseModel):
    vehicle_id: uuid.UUID
    estimated_minutes: float
    confidence_interval_low: float
    confidence_interval_high: float
    traffic_impact_minutes: float
    weather_impact_minutes: float
    model_version: str


# ---------------------------------------------------------------------------
# Telemetry
# ---------------------------------------------------------------------------
class TelemetryCreate(BaseModel):
    vehicle_id: uuid.UUID
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    speed_kmph: float = Field(ge=0, le=300)
    heading: float = Field(ge=0, le=360)
    fuel_level_pct: float = Field(ge=0, le=100)
    engine_temp: Optional[float] = None
    odometer_km: Optional[float] = None


class TelemetryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    vehicle_id: uuid.UUID
    timestamp: datetime
    latitude: float
    longitude: float
    speed_kmph: float
    fuel_level_pct: float


# ---------------------------------------------------------------------------
# Dashboard / Analytics
# ---------------------------------------------------------------------------
class KPIResponse(BaseModel):
    active_vehicles: int
    on_time_rate_pct: float
    fuel_cost_today: float
    fuel_saved_pct: float
    total_deliveries_today: int
    avg_eta_accuracy_pct: float
    rerouting_events_today: int


class FleetSummary(BaseModel):
    total: int
    active: int
    idle: int
    maintenance: int
    offline: int


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------
class PaginatedResponse(BaseModel):
    items: List[Any]
    total: int
    page: int
    size: int
    pages: int


# ---------------------------------------------------------------------------
# Shipments & Cargo
# ---------------------------------------------------------------------------
class ParcelBase(BaseModel):
    weight_kg: float = Field(gt=0)
    length_cm: float = Field(gt=0)
    width_cm: float = Field(gt=0)
    height_cm: float = Field(gt=0)
    category: str = "General"
    is_hazardous: bool = False
    is_fragile: bool = False


class ParcelCreate(ParcelBase):
    pass


class ParcelResponse(ParcelBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    shipment_id: uuid.UUID


class ShipmentCreate(BaseModel):
    tracking_id: Optional[str] = None
    priority: str = Field(default="medium", pattern="^(low|medium|high|critical)$")
    parcels: List[ParcelCreate] = Field(min_length=0, default_factory=list) # Optional if payload summary is used
    delivery_point_id: Any # UUID or Mapbox ID
    
    # --- Origin Data ---
    origin_name: Optional[str] = None
    origin_address: Optional[str] = None
    origin_lat: Optional[float] = None
    origin_lng: Optional[float] = None
    
    # --- Destination Data (if new) ---
    dest_name: Optional[str] = None
    dest_address: Optional[str] = None
    dest_lat: Optional[float] = None
    dest_lng: Optional[float] = None

    # --- Payload Summary ---
    total_items: Optional[int] = 1
    total_weight_kg: Optional[float] = 0.0

    # --- Mobile GPS Option ---
    enable_mobile_gps: Optional[bool] = False


class ShipmentUpdate(BaseModel):
    status: Optional[str] = Field(None, pattern="^(created|picked_up|in_transit|delivered|cancelled)$")
    priority: Optional[str] = Field(None, pattern="^(low|medium|high|critical)$")
    received_by: Optional[str] = Field(None, max_length=100)
    signature_data: Optional[str] = None # Base64
    origin_name: Optional[str] = None
    origin_address: Optional[str] = None
    origin_lat: Optional[float] = None
    origin_lng: Optional[float] = None
    total_items: Optional[int] = None
    total_weight_kg: Optional[float] = None


class ShipmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    tracking_id: str
    status: str
    priority: str
    parcels: List[ParcelResponse]
    delivery_point: Optional[DeliveryPointResponse] = None
    
    origin_name: Optional[str] = None
    origin_address: Optional[str] = None
    origin_lat: Optional[float] = None
    origin_lng: Optional[float] = None
    
    total_items: Optional[int] = 1
    total_weight_kg: Optional[float] = 0.0
    
    created_at: datetime
    is_verified: bool = True
    received_by: Optional[str] = None
    signature_data: Optional[str] = None
