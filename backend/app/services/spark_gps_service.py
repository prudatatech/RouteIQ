import httpx
import logging
import uuid
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import Vehicle, Telemetry, Route, RouteStop
from sqlalchemy.orm import joinedload, selectinload
import random
from app.services.telemetry_service import TelemetryService

logger = logging.getLogger("routeiq.sparkgps")

class SparkGPSService:
    """
    Service for integrating with the SparkGPS (Roadcast) API.
    Handles real-time telemetry syncing for active cargo vehicles.
    """

    @staticmethod
    async def fetch_and_sync(db: AsyncSession):
        """
        Polls SparkGPS API and updates internal telemetry.
        """
        # 1. Ensure we have a token
        token = settings.SPARK_GPS_API_TOKEN
        if not token and settings.SPARK_GPS_USERNAME and settings.SPARK_GPS_PASSWORD:
            token = await SparkGPSService._get_access_token()
            
        if not token:
            logger.warning("SparkGPS API Token or credentials missing. Falling back to mock sync.")
            await SparkGPSService.mock_sync_for_demo(db)
            return

        try:
            # 1. Fetch from SparkGPS
            external_data = await SparkGPSService._fetch_from_api()
            if not external_data:
                logger.info("No external data fetched from SparkGPS API.")
                return

            # 2. Get all RouteIQ vehicles to map by spark_id or plate number
            result = await db.execute(select(Vehicle))
            internal_vehicles = result.scalars().all()
            
            # Map spark_id -> Vehicle and plate_number -> Vehicle
            spark_map = {v.spark_id: v for v in internal_vehicles if v.spark_id}
            plate_map = {v.plate_number.replace("-", "").upper(): v for v in internal_vehicles}

            # 3. Process and ingest
            synced_count = 0
            target_plates = {"HR38AC1276", "HR38AC1658"}
            
            for item in external_data:
                # Roadcast typically returns 'device_id' or 'imei' for spark_id
                device_id = item.get("device_id") or item.get("imei")
                raw_plate = item.get("reg_no", "")
                plate = raw_plate.replace("-", "").upper()
                
                vehicle = None
                if device_id and device_id in spark_map:
                    vehicle = spark_map[device_id]
                elif plate in plate_map:
                    vehicle = plate_map[plate]

                if vehicle:
                    if plate in target_plates:
                        logger.info(f"MATCH: Found hardware data for target vehicle {raw_plate}")

                    # Create telemetry record
                    telemetry_data = {
                        "vehicle_id": str(vehicle.id),
                        "latitude": float(item.get("lat", 0)),
                        "longitude": float(item.get("lng", 0)),
                        "speed_kmph": float(item.get("speed", 0)),
                        "heading": float(item.get("heading", 0)),
                        "fuel_level_pct": float(item.get("fuel", 100)),
                        "timestamp": datetime.now(timezone.utc)
                    }
                    
                    # Determine if this is a high-priority vehicle (Cold Chain or Hazardous)
                    cargo_types = getattr(vehicle, "cargo_types", []) or []
                    is_high_priority = any(ct in ["cold_chain", "hazardous"] for ct in cargo_types)

                    # Update vehicle state directly for quick UI updates
                    vehicle.latitude = telemetry_data["latitude"]
                    vehicle.longitude = telemetry_data["longitude"]
                    vehicle.last_sync = telemetry_data["timestamp"]
                    vehicle.status = "on_route" # Ensure status is active when live sync happens
                    
                    # Store in DB and broadcast via WebSockets
                    await TelemetryService.ingest_telemetry(db, telemetry_data)
                    synced_count += 1
                else:
                    if plate in target_plates:
                        logger.warning(f"MISS: Target plate {raw_plate} found in API but no vehicle matched in database.")

            if synced_count > 0:
                logger.info(f"Successfully synced {synced_count} vehicles from SparkGPS.")

        except Exception as e:
            logger.error(f"Error syncing SparkGPS data: {str(e)}")

    @staticmethod
    async def _get_access_token() -> Optional[str]:
        """
        Authenticates with SparkGPS using credentials to get a temporary token.
        """
        url = f"{settings.SPARK_GPS_API_URL}/auth/login"
        payload = {
            "username": settings.SPARK_GPS_USERNAME,
            "password": settings.SPARK_GPS_PASSWORD
        }
        
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(url, json=payload, timeout=10.0)
                if response.status_code == 200:
                    data = response.json()
                    # Cache token in memory settings for subsequent calls
                    token = data.get("access_token") or data.get("token")
                    if token:
                        settings.SPARK_GPS_API_TOKEN = token
                        return token
                logger.error(f"SparkGPS Auth Failed: {response.status_code} - {response.text}")
            except Exception as e:
                logger.error(f"SparkGPS Auth Exception: {str(e)}")
        return None

    @staticmethod
    async def _fetch_from_api() -> List[Dict[str, Any]]:
        """
        Internal helper to perform the HTTP request.
        """
        url = f"{settings.SPARK_GPS_API_URL}/vehicles/live"
        headers = {
            "Authorization": f"Bearer {settings.SPARK_GPS_API_TOKEN}",
            "Content-Type": "application/json"
        }

        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(url, headers=headers, timeout=10.0)
                if response.status_code == 200:
                    return response.json().get("data", [])
                elif response.status_code == 401:
                    # Token might have expired, clear it
                    settings.SPARK_GPS_API_TOKEN = ""
                    logger.error("SparkGPS API Unauthorized. Clearing token for refresh.")
                else:
                    logger.error(f"SparkGPS API Error: {response.status_code} - {response.text}")
            except Exception as e:
                logger.error(f"HTTP Request to SparkGPS failed: {str(e)}")
        
        return []

    @staticmethod
    async def mock_sync_for_demo(db: AsyncSession):
        """
        Simulates SparkGPS data if no token is available (for local testing).
        Moves vehicles towards their next pending stop on their active route.
        """
        # Fetch routes with their vehicle and stops
        result = await db.execute(
            select(Route)
            .options(
                joinedload(Route.vehicle), 
                selectinload(Route.stops).joinedload(RouteStop.delivery_point)
            )
            .where(Route.status == "active")
        )
        active_routes = result.scalars().all()

        if not active_routes:
            logger.info("No active routes found for mock sync.")
            return

        for route in active_routes:
            # 1. Get current location from latest telemetry
            tele_result = await db.execute(
                select(Telemetry)
                .where(Telemetry.vehicle_id == route.vehicle_id)
                .order_by(Telemetry.timestamp.desc())
                .limit(1)
            )
            latest_tele = tele_result.scalar_one_or_none()
            
            curr_lat = latest_tele.latitude if latest_tele else (route.vehicle.latitude or 28.6139)
            curr_lng = latest_tele.longitude if latest_tele else (route.vehicle.longitude or 77.2090)
            
            # 2. Find next pending stop
            next_stop = next((s for s in sorted(route.stops, key=lambda x: x.sequence) if s.status == "pending"), None)
            
            if next_stop and next_stop.delivery_point:
                target_lat = next_stop.delivery_point.latitude
                target_lng = next_stop.delivery_point.longitude
                
                # Move slightly towards target (simulating vehicle movement)
                # Jitter speed: ~50km/h is roughly 0.0001 degrees per second?
                # For demo purposes, we move 0.002 degrees (~200m) per sync
                step_lat = (target_lat - curr_lat) * 0.1
                step_lng = (target_lng - curr_lng) * 0.1
                
                # Cap the step to avoid teleporting
                limit = 0.005 
                new_lat = curr_lat + max(-limit, min(limit, step_lat))
                new_lng = curr_lng + max(-limit, min(limit, step_lng))
                
                speed = 45.0 + (uuid.uuid4().int % 25)
            else:
                # No next stop, idle or stay at last point
                new_lat = curr_lat + (random.uniform(-0.0001, 0.0001))
                new_lng = curr_lng + (random.uniform(-0.0001, 0.0001))
                speed = 0.0

            telemetry_data = {
                "vehicle_id": str(route.vehicle_id),
                "latitude": new_lat,
                "longitude": new_lng,
                "speed_kmph": speed,
                "heading": random.uniform(0, 360),
                "timestamp": datetime.now(timezone.utc)
            }
            
            # 3. Update vehicle state and ingest telemetry
            route.vehicle.latitude = new_lat
            route.vehicle.longitude = new_lng
            route.vehicle.last_sync = telemetry_data["timestamp"]
            
            await TelemetryService.ingest_telemetry(db, telemetry_data)
            
        logger.info(f"Mock sync complete for {len(active_routes)} active routes.")
