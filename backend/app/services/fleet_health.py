import asyncio
import logging
from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.models import Vehicle
from app.core.websocket import manager

logger = logging.getLogger("routeiq.fleet_health")

class FleetHealthMonitor:
    def __init__(self, timeout_minutes: int = 2):
        self.timeout_minutes = timeout_minutes
        self._running = False

    async def start(self):
        self._running = True
        logger.info(f"Fleet Health Monitor started (Timeout: {self.timeout_minutes}m)")
        while self._running:
            try:
                await self.check_fleet_health()
            except Exception as e:
                logger.error(f"Error in fleet health check: {e}")
            
            await asyncio.sleep(30) # Check every 30 seconds

    async def stop(self):
        self._running = False

    async def check_fleet_health(self):
        timeout_threshold = datetime.now(timezone.utc) - timedelta(minutes=self.timeout_minutes)
        
        async with AsyncSessionLocal() as session:
            # Find vehicles that should be offline but are still marked active/idle
            # Inclusion of NOT NULL filter is critical to avoid constant rollbacks or invalid comparisons
            query = (
                select(Vehicle)
                .where(Vehicle.status.in_(["available", "on_route", "idle"]))
                .where(Vehicle.last_heartbeat.is_not(None))
                .where(Vehicle.last_heartbeat < timeout_threshold)
            )
            result = await session.execute(query)
            stale_vehicles = result.scalars().all()

            if not stale_vehicles:
                # Still commit explicitly or close normally to avoid transaction noise
                await session.commit() 
                return

            for vehicle in stale_vehicles:
                # Determine if this is a high-priority vehicle (Cold Chain or Hazardous)
                cargo_types = getattr(vehicle, "cargo_types", []) or []
                is_high_priority = any(ct in ["cold_chain", "hazardous"] for ct in cargo_types)
                
                logger.warning(f"Vehicle {vehicle.plate_number} ({vehicle.id}) timed out. Marking OFFLINE.")
                vehicle.status = "offline"
                
                # Broadcast the disconnect to dashboard clients
                msg_type = "ALERT_CRITICAL" if is_high_priority else "VEHICLE_OFFLINE"
                await manager.broadcast({
                    "type": msg_type,
                    "data": {
                        "vehicle_id": str(vehicle.id),
                        "plate_number": vehicle.plate_number,
                        "cargo_types": vehicle.cargo_types,
                        "reason": "heartbeat_timeout",
                        "severity": "critical" if is_high_priority else "info",
                        "message": f"CRITICAL: {vehicle.plate_number} ({', '.join(vehicle.cargo_types or ['general'])}) has disconnected!" if is_high_priority else f"{vehicle.plate_number} went offline."
                    }
                })

            await session.commit()

fleet_health_monitor = FleetHealthMonitor()
