import logging
import math
import json
import httpx
from typing import Optional
from app.core.websocket import manager
from app.core.config import settings

logger = logging.getLogger(__name__)

class IntelligenceEngine:
    @staticmethod
    def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Calculate the great circle distance between two points on the earth (specified in decimal degrees) in km."""
        lon1, lat1, lon2, lat2 = map(math.radians, [lon1, lat1, lon2, lat2])
        dlon = lon2 - lon1
        dlat = lat2 - lat1
        a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
        c = 2 * math.asin(math.sqrt(a))
        r = 6371 # Radius of earth in kilometers
        return c * r

    @staticmethod
    async def get_mapbox_eta(lat1: float, lon1: float, lat2: float, lon2: float) -> tuple[Optional[float], Optional[float]]:
        """Calls Mapbox Directions API and returns (distance_km, eta_minutes)."""
        token = settings.MAPBOX_ACCESS_TOKEN
        if not token:
            return None, None
            
        url = f"https://api.mapbox.com/directions/v5/mapbox/driving/{lon1},{lat1};{lon2},{lat2}?access_token={token}"
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, timeout=5.0)
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get("routes") and len(data["routes"]) > 0:
                        route = data["routes"][0]
                        dist_km = route.get("distance", 0) / 1000.0
                        duration_mins = route.get("duration", 0) / 60.0
                        return dist_km, duration_mins
        except Exception as e:
            logger.error(f"Failed to fetch Mapbox ETA: {e}")
        return None, None

    @staticmethod
    async def process_telemetry(vehicle_id: str, lat: float, lng: float, speed_kmph: float):
        """
        Processes incoming telemetry to trigger ETA updates and geofence alerts.
        """
        try:
            # Simulated Geofence check against a mock destination
            target_lat, target_lng = 28.61, 77.23
            
            # Mapbox API ETA Calculation
            dist_km, eta_mins = await IntelligenceEngine.get_mapbox_eta(lat, lng, target_lat, target_lng)
            
            if dist_km is None or eta_mins is None:
                # Fallback to straight-line
                dist_km = IntelligenceEngine.calculate_distance(lat, lng, target_lat, target_lng)
                eta_mins = (dist_km / 40.0) * 60 if dist_km > 0.5 else 0

            # Geofence Engine: If within 500m (0.5km), trigger Arrival Alert
            if dist_km < 0.5:
                await manager.broadcast(json.dumps({
                    "type": "GEOFENCE_ALERT",
                    "data": {
                        "vehicle_id": vehicle_id,
                        "alert_type": "ARRIVAL",
                        "message": "Vehicle has entered the destination geofence.",
                        "distance_km": round(dist_km, 2)
                    }
                }))
            
            # AI Reroute Agent: Detect simulated heavy traffic and suggest reroute
            # Trigger randomly or if speed drops below 20kmph while far from destination
            import random
            if speed_kmph < 20 and dist_km > 5 and random.random() > 0.8:
                await manager.broadcast(json.dumps({
                    "type": "AI_REROUTE_SUGGESTION",
                    "data": {
                        "vehicle_id": vehicle_id,
                        "message": "Heavy traffic detected ahead. Alternative route available saving 32 mins.",
                        "time_saved_mins": 32,
                        "new_eta_mins": max(1, round(eta_mins - 32))
                    }
                }))

            # Periodically broadcast ETA update
            await manager.broadcast(json.dumps({
                "type": "ETA_UPDATE",
                "data": {
                    "vehicle_id": vehicle_id,
                    "eta_minutes": round(eta_mins),
                    "remaining_km": round(dist_km, 1)
                }
            }))
            
        except Exception as e:
            logger.error(f"Error in intelligence engine: {e}")
