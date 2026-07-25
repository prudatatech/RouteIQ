import uuid
import logging
from datetime import datetime, timezone
from typing import Dict, Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.models import Telemetry, Vehicle
from app.core.redis import cache_set, cache_get
from app.core.websocket import manager
from app.core.database import AsyncSessionLocal
from app.services.intelligence_engine import IntelligenceEngine

logger = logging.getLogger("routeiq.telemetry")

class TelemetryService:
    @staticmethod
    async def ingest_telemetry(db: AsyncSession, data: Dict[str, Any]) -> Telemetry:
        """
        Logic for ingesting telemetry data, updating vehicle state,
        caching in Redis, and broadcasting via WebSockets.
        """
        vehicle_id = uuid.UUID(data["vehicle_id"]) if isinstance(data["vehicle_id"], str) else data["vehicle_id"]
        
        # 1. Fetch vehicle
        result = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
        vehicle = result.scalar_one_or_none()
        if not vehicle:
            raise ValueError(f"Vehicle {vehicle_id} not found")

        # 2. Create Telemetry record
        t = Telemetry(
            vehicle_id=vehicle_id,
            latitude=data["latitude"],
            longitude=data["longitude"],
            speed_kmph=data.get("speed_kmph", 0),
            heading=data.get("heading", 0),
            fuel_level_pct=data.get("fuel_level_pct"),
            timestamp=data.get("timestamp") or datetime.now(timezone.utc)
        )
        db.add(t)

        # 3. Update vehicle live position and fuel in DB
        vehicle.latitude = data["latitude"]
        vehicle.longitude = data["longitude"]
        vehicle.last_heartbeat = t.timestamp
        if data.get("fuel_level_pct") is not None:
            capacity = vehicle.fuel_capacity_liters or 60.0
            vehicle.current_fuel_liters = (data["fuel_level_pct"] / 100) * capacity

        await db.flush()

        # 4. Cache latest position in Redis
        live_data = {
            "vehicle_id": str(vehicle_id),
            "lat": data["latitude"], 
            "lng": data["longitude"], 
            "speed": data.get("speed_kmph", 0),
            "fuel": data.get("fuel_level_pct"),
            "timestamp": t.timestamp.isoformat()
        }
        
        await cache_set(
            f"vehicle:live:{vehicle_id}",
            live_data,
            ttl=120,
        )
        
        # 5. BROADCAST TO ALL DASHBOARD CLIENTS
        await manager.broadcast({
            "type": "TELEMETRY_UPDATE",
            "data": live_data
        })

        # 6. INTELLIGENCE RULES (Simplified for service)
        if data.get("speed_kmph", 0) > 85.0:
            await manager.broadcast({
                "type": "ALERT_WARNING",
                "title": "High Speed Alert",
                "message": f"Vehicle {vehicle.plate_number} exceeding safety limit: {data['speed_kmph']:.1f} km/h",
                "payload": {"vehicle_id": str(vehicle.id), "plate_number": vehicle.plate_number}
            })

        # 7. AI INCUBATOR: Trigger re-optimization check for active routes
        if vehicle.status == "on_route":
            # Avoid re-optimization on every single ping (e.g. only every 2 mins max)
            lock_key = f"reroute_check_lock:{vehicle_id}"
            if not await cache_get(lock_key):
                await cache_set(lock_key, "locked", ttl=120)
                # Run re-optimization in background to not block ingestion
                import asyncio
                asyncio.create_task(TelemetryService._trigger_reroute_check(str(vehicle_id)))

        return t

    @staticmethod
    async def _trigger_reroute_check(vehicle_id: str):
        """Background task to run a reroute scan."""
        try:
            async with AsyncSessionLocal() as db:
                from app.api.v1.endpoints.optimization import incubate_routing
                # We reuse the incubation logic which saves results to Redis
                # Note: This is a hacky way to call an endpoint-like function, 
                # but it ensures consistent behavior.
                from app.schemas.schemas import TokenData
                mock_token = TokenData(user_id="system", role="admin")
                await incubate_routing(vehicle_id, db, mock_token)
                await db.commit()
        except Exception as e:
            logger.error(f"Background reroute check failed for {vehicle_id}: {str(e)}")
