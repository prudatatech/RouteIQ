from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import require_role
from app.schemas.auth import TokenData
from app.agents.dispatch_agent import DispatchAgent
from app.agents.risk_agent import RiskAgent
from app.agents.cargo_agent import CargoMonitoringAgent
from app.services.vehicle_service import VehicleService
from app.services.shipment_service import ShipmentService
from app.services.telemetry_service import TelemetryService
import uuid

router = APIRouter()

@router.post("/dispatch/{shipment_id}")
async def run_dispatch_agent(
    shipment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: TokenData = Depends(require_role("admin", "superadmin", "manager"))
):
    """
    Run the AI Dispatch Agent for a specific shipment.
    """
    # 1. Get shipment details
    shipment = await ShipmentService.get_shipment(db, shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    
    # 2. Get available vehicles and drivers
    vehicles = await VehicleService.list_vehicles(db, skip=0, limit=100)
    available_vehicles = [v for v in vehicles if v.status == "available"]
    
    if not available_vehicles:
        return {"status": "error", "message": "No available vehicles found for dispatch."}

    # 3. Format data for the agent
    shipment_details = {
        "tracking_id": shipment.tracking_id,
        "weight_kg": shipment.total_weight_kg,
        "origin": shipment.origin_address,
        "destination": shipment.delivery_point.address if shipment.delivery_point else "Unknown",
        "priority": shipment.priority
    }
    
    vehicle_data = [
        {"id": str(v.id), "plate": v.plate_number, "type": v.vehicle_type, "capacity": v.capacity_kg}
        for v in available_vehicles
    ]
    
    driver_data = [
        {"id": str(v.driver_id), "name": v.driver.full_name if v.driver else "Unknown"}
        for v in available_vehicles if v.driver_id
    ]

    # 4. Run the Agent
    agent = DispatchAgent()
    result = agent.run_dispatch(shipment_details, driver_data, vehicle_data)

    return {
        "status": "success",
        "shipment_id": str(shipment_id),
        "recommendation": result
    }

@router.post("/risk-analysis/{vehicle_id}")
async def run_risk_agent(
    vehicle_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: TokenData = Depends(require_role("admin", "superadmin", "manager"))
):
    """
    Run the AI Risk Agent for a specific vehicle/route.
    """
    # Fetch telemetry and route data
    telemetry = await TelemetryService.get_vehicle_telemetry(db, vehicle_id, limit=20)
    
    agent = RiskAgent()
    result = agent.run_analysis(
        route_data={"vehicle_id": str(vehicle_id)},
        telemetry_history=[{"lat": t.latitude, "lng": t.longitude, "speed": t.speed_kmph} for t in telemetry],
        weather_traffic_data={"weather": "clear", "traffic": "moderate"}
    )
    
    return {"status": "success", "result": result}

@router.post("/cargo-monitoring/{shipment_id}")
async def run_cargo_agent(
    shipment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: TokenData = Depends(require_role("admin", "superadmin", "manager"))
):
    """
    Run the AI Cargo Monitoring Agent for a specific shipment.
    """
    shipment = await ShipmentService.get_shipment(db, shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")

    agent = CargoMonitoringAgent()
    result = agent.run_monitoring(
        cargo_details={"id": shipment.tracking_id, "weight": shipment.total_weight_kg, "priority": shipment.priority},
        telemetry_data={"temp": 4.2, "humidity": 45, "vibration_g": 0.1} # Sample sensor data
    )
    
    return {"status": "success", "result": result}
