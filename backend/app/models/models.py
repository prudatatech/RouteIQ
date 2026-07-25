"""SQLAlchemy ORM models."""
import uuid
from datetime import datetime
from typing import Optional, List

from sqlalchemy import (
    Boolean, DateTime, Enum, Float, ForeignKey,
    Integer, String, Text, JSON, func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def uuid_pk():
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


# ================= USERS =================
class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255))
    hashed_password: Mapped[str] = mapped_column(String(255))

    role: Mapped[str] = mapped_column(
        Enum("superadmin", "admin", "manager", "driver", name="user_role"),
        default="driver",
    )

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    vehicles = relationship("Vehicle", back_populates="driver")


# ================= VEHICLES =================
class Vehicle(Base, TimestampMixin):
    __tablename__ = "vehicles"

    id: Mapped[uuid.UUID] = uuid_pk()
    plate_number: Mapped[str] = mapped_column(String(20), unique=True)

    vehicle_type: Mapped[str] = mapped_column(
        Enum("truck", "van", "bike", "car", name="vehicle_type"),
        default="truck",
    )

    capacity_kg: Mapped[float] = mapped_column(Float, default=1000)
    fuel_type: Mapped[str] = mapped_column(String(20), default="diesel")
    fuel_capacity_liters: Mapped[float] = mapped_column(Float, default=60.0)
    fuel_efficiency_kmpl: Mapped[float] = mapped_column(Float, default=12.0)
    current_fuel_liters: Mapped[float] = mapped_column(Float, default=60.0)

    status: Mapped[str] = mapped_column(
        Enum("available", "on_route", "idle", "maintenance", "offline", name="vehicle_status"),
        default="available",
    )

    # GPS tracking relationship
    gps_points: Mapped[List["GPSPoint"]] = relationship("GPSPoint", back_populates="vehicle", cascade="all, delete-orphan")
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    last_heartbeat: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # --- Hardware Mapping ---
    spark_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True) # Physical GPS Device ID
    last_sync: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    driver_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"))
    cargo_types: Mapped[Optional[list]] = mapped_column(JSON, default=list)

    driver = relationship("User", back_populates="vehicles")
    routes = relationship("Route", back_populates="vehicle", cascade="all, delete-orphan")
    telemetry = relationship("Telemetry", back_populates="vehicle", cascade="all, delete-orphan")
    alerts = relationship("MaintenanceAlert", back_populates="vehicle", cascade="all, delete-orphan")
    stoppages = relationship("VehicleStoppage", back_populates="vehicle", cascade="all, delete-orphan")


# ================= DEPOTS =================
class Depot(Base, TimestampMixin):
    __tablename__ = "depots"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(255))
    address: Mapped[str] = mapped_column(Text)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    speed_kmph: Mapped[float] = mapped_column(Float, default=0.0)
    heading: Mapped[float] = mapped_column(Float, default=0.0)
    fuel_level_pct: Mapped[float] = mapped_column(Float, default=100.0)
    engine_temp: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    odometer_km: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cargo_types: Mapped[Optional[list]] = mapped_column(JSON, default=list)


# ================= DELIVERY POINTS =================
class DeliveryPoint(Base, TimestampMixin):
    __tablename__ = "delivery_points"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(255))
    address: Mapped[str] = mapped_column(Text)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    speed_kmph: Mapped[float] = mapped_column(Float, default=0.0)
    heading: Mapped[float] = mapped_column(Float, default=0.0)
    fuel_level_pct: Mapped[float] = mapped_column(Float, default=100.0)
    engine_temp: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    odometer_km: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cargo_types: Mapped[Optional[list]] = mapped_column(JSON, default=list)

    demand_kg: Mapped[float] = mapped_column(Float, default=0.0)
    service_time_minutes: Mapped[int] = mapped_column(Integer, default=10)
    required_cargo_types: Mapped[Optional[list]] = mapped_column(JSON, default=list) # e.g. ["cold_chain", "hazardous"]
    status: Mapped[str] = mapped_column(
        String(20), default="pending"
    )

    shipment_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("shipments.id"))
    shipment = relationship("Shipment", back_populates="delivery_point")


# ================= ROUTES =================
class Route(Base, TimestampMixin):
    __tablename__ = "routes"

    id: Mapped[uuid.UUID] = uuid_pk()
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicles.id"))
    depot_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("depots.id"))

    status: Mapped[str] = mapped_column(
        Enum("pending", "optimizing", "active", "completed", "cancelled", name="route_status"),
        default="pending",
    )

    total_distance_km: Mapped[float] = mapped_column(Float, default=0.0)
    total_duration_minutes: Mapped[float] = mapped_column(Float, default=0.0)
    estimated_fuel_liters: Mapped[float] = mapped_column(Float, default=0.0)

    # --- Intelligence ---
    weather_condition: Mapped[str] = mapped_column(String(50), default="clear")
    traffic_delay_minutes: Mapped[int] = mapped_column(Integer, default=0)

    # ✅ REQUIRED BY DB
    waypoints: Mapped[list] = mapped_column(JSON, default=list)
    optimization_score: Mapped[float] = mapped_column(Float, default=0.0)

    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    vehicle = relationship("Vehicle", back_populates="routes")
    stops = relationship("RouteStop", back_populates="route", cascade="all, delete-orphan")


class RouteStop(Base, TimestampMixin):
    __tablename__ = "route_stops"

    id: Mapped[uuid.UUID] = uuid_pk()
    route_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("routes.id"))
    delivery_point_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("delivery_points.id"))
    sequence: Mapped[int] = mapped_column(Integer)

    status: Mapped[str] = mapped_column(
        String(20), default="pending"
    )

    route = relationship("Route", back_populates="stops")
    delivery_point = relationship("DeliveryPoint")



# ================= TELEMETRY =================
class Telemetry(Base):
    __tablename__ = "telemetry"

    id: Mapped[uuid.UUID] = uuid_pk()
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicles.id"))
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    speed_kmph: Mapped[float] = mapped_column(Float, default=0.0)
    heading: Mapped[float] = mapped_column(Float, default=0.0)
    fuel_level_pct: Mapped[float] = mapped_column(Float, default=100.0)
    engine_temp: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    odometer_km: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cargo_types: Mapped[Optional[list]] = mapped_column(JSON, default=list)
    speed_kmph: Mapped[float] = mapped_column(Float, default=0.0)
    heading: Mapped[float] = mapped_column(Float, default=0.0)
    fuel_level_pct: Mapped[float] = mapped_column(Float, default=100.0)
    engine_temp: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    odometer_km: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    vehicle = relationship("Vehicle", back_populates="telemetry")


class VehicleStoppage(Base, TimestampMixin):
    __tablename__ = "vehicle_stoppages"

    id: Mapped[uuid.UUID] = uuid_pk()
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicles.id"))
    
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    end_time: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    speed_kmph: Mapped[float] = mapped_column(Float, default=0.0)
    heading: Mapped[float] = mapped_column(Float, default=0.0)
    fuel_level_pct: Mapped[float] = mapped_column(Float, default=100.0)
    engine_temp: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    odometer_km: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cargo_types: Mapped[Optional[list]] = mapped_column(JSON, default=list)
    
    reason: Mapped[str] = mapped_column(String(255), default="unknown") # "Traffic", "Fuel", "Delivery", "Break"
    duration_minutes: Mapped[int] = mapped_column(Integer, default=0)

    vehicle = relationship("Vehicle", back_populates="stoppages")


# ================= ALERTS =================
class MaintenanceAlert(Base, TimestampMixin):
    __tablename__ = "maintenance_alerts"

    id: Mapped[uuid.UUID] = uuid_pk()
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicles.id"))
    
    alert_type: Mapped[str] = mapped_column(String(50)) # "Engine", "Fuel", "Brake", "Tire"
    severity: Mapped[str] = mapped_column(
        Enum("low", "medium", "high", "critical", name="alert_severity"),
        default="medium",
    )
    description: Mapped[str] = mapped_column(Text)
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    vehicle = relationship("Vehicle", back_populates="alerts")


# ================= SHIPMENTS =================
class Shipment(Base, TimestampMixin):
    __tablename__ = "shipments"

    id: Mapped[uuid.UUID] = uuid_pk()
    tracking_id: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    status: Mapped[str] = mapped_column(
        Enum("created", "picked_up", "in_transit", "delivered", "cancelled", name="shipment_status"),
        default="created",
    )
    priority: Mapped[str] = mapped_column(
        Enum("low", "medium", "high", "critical", name="shipment_priority"),
        default="medium",
    )

    parcels = relationship("Parcel", back_populates="shipment")
    delivery_point = relationship("DeliveryPoint", back_populates="shipment", uselist=False)
    logs = relationship("ShipmentLog", back_populates="shipment", order_by="ShipmentLog.index")

    # --- Origin / Departure ---
    origin_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    origin_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    origin_lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    origin_lng: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # --- Summary ---
    total_items: Mapped[Optional[int]] = mapped_column(Integer, default=1, nullable=True)
    total_weight_kg: Mapped[Optional[float]] = mapped_column(Float, default=0.0, nullable=True)

    # --- Proof of Delivery ---
    received_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    signature_data: Mapped[Optional[str]] = mapped_column(Text, nullable=True) # Base64


class Parcel(Base, TimestampMixin):
    __tablename__ = "parcels"

    id: Mapped[uuid.UUID] = uuid_pk()
    shipment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("shipments.id"))

    weight_kg: Mapped[float] = mapped_column(Float)
    length_cm: Mapped[float] = mapped_column(Float)
    width_cm: Mapped[float] = mapped_column(Float)
    height_cm: Mapped[float] = mapped_column(Float)

    category: Mapped[str] = mapped_column(String(50))  # e.g. "Electronics", "Fragile"
    is_hazardous: Mapped[bool] = mapped_column(Boolean, default=False)
    is_fragile: Mapped[bool] = mapped_column(Boolean, default=False)

    shipment = relationship("Shipment", back_populates="parcels")


class ShipmentLog(Base):
    __tablename__ = "shipment_logs"

    id: Mapped[uuid.UUID] = uuid_pk()
    shipment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("shipments.id"))
    status: Mapped[str] = mapped_column(String(50))
    location_lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    location_lng: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    index: Mapped[int] = mapped_column(Integer)
    previous_hash: Mapped[str] = mapped_column(String(64))
    log_hash: Mapped[str] = mapped_column(String(64))

    metadata_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True, default=dict)

    shipment = relationship("Shipment", back_populates="logs")


# ================= BILLING =================
class Invoice(Base, TimestampMixin):
    __tablename__ = "invoices"

    id: Mapped[uuid.UUID] = uuid_pk()
    shipment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("shipments.id"))
    
    invoice_number: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    amount: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    
    status: Mapped[str] = mapped_column(
        Enum("unpaid", "paid", "overdue", "cancelled", name="invoice_status"),
        default="unpaid",
    )
    
    due_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    shipment = relationship("Shipment")
    payments = relationship("Payment", back_populates="invoice")


class Payment(Base, TimestampMixin):
    __tablename__ = "payments"

    id: Mapped[uuid.UUID] = uuid_pk()
    invoice_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("invoices.id"))
    
    amount: Mapped[float] = mapped_column(Float)
    payment_method: Mapped[str] = mapped_column(String(50)) # "Credit Card", "Bank Transfer", "Crypto"
    transaction_id: Mapped[str] = mapped_column(String(100), unique=True)
    
    status: Mapped[str] = mapped_column(
        Enum("pending", "completed", "failed", "refunded", name="payment_status"),
        default="pending",
    )

    invoice = relationship("Invoice", back_populates="payments")



class GPSPoint(Base, TimestampMixin):
    __tablename__ = "gps_points"

    id: Mapped[uuid.UUID] = uuid_pk()
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicles.id"))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    accuracy: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    vehicle = relationship("Vehicle", back_populates="gps_points")

class AIAgentLog(Base, TimestampMixin):
    __tablename__ = "ai_agent_logs"

    id: Mapped[uuid.UUID] = uuid_pk()
    agent_name: Mapped[str] = mapped_column(String(100)) # "DispatchAgent", "RiskAgent", etc.
    task_description: Mapped[str] = mapped_column(Text)
    action_taken: Mapped[str] = mapped_column(Text)
    result: Mapped[str] = mapped_column(Text)
    
    status: Mapped[str] = mapped_column(String(20), default="success") # "success", "failed", "pending"
    
    metadata_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True, default=dict)