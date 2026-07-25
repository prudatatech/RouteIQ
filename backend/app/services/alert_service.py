import uuid
from datetime import datetime, timedelta

class AlertService:
    """
    Handles generation and monitoring of logistics alerts.
    Trigger rule: actual_eta > planned_eta * 1.15
    """
    
    @staticmethod
    async def check_eta_delay(planned_eta: datetime, current_location: tuple, destination: tuple, current_speed_kmh: float) -> bool:
        """
        Check if the current ETA exceeds planned ETA by 15%.
        """
        if not planned_eta:
            return False
            
        # Simplified distance/time calculation
        import math
        def haversine(p1, p2):
            R = 6371 # Earth radius in km
            lat1, lon1 = math.radians(p1[0]), math.radians(p1[1])
            lat2, lon2 = math.radians(p2[0]), math.radians(p2[1])
            dlat = lat2 - lat1
            dlon = lon2 - lon1
            a = math.sin(dlat / 2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2)**2
            c = 2 * math.asin(math.sqrt(a))
            return R * c

        distance_rem = haversine(current_location, destination)
        
        # Avoid division by zero
        speed = max(current_speed_kmh, 1.0)
        hours_rem = distance_rem / speed
        
        current_time = datetime.now()
        estimated_arrival = current_time + timedelta(hours=hours_rem)
        
        planned_duration = (planned_eta - current_time).total_seconds()
        estimated_duration = (estimated_arrival - current_time).total_seconds()
        
        # Trigger at 15% delay
        if estimated_duration > planned_duration * 1.15:
            return True
            
        return False

    @staticmethod
    async def create_delay_alert(vehicle_id: uuid.UUID, shipment_id: uuid.UUID, delay_minutes: int) -> dict:
        """
        Create a delay alert for the news ticker.
        """
        return {
            "id": str(uuid.uuid4()),
            "type": "ETA_DELAY",
            "vehicle_id": str(vehicle_id),
            "shipment_id": str(shipment_id),
            "message": f"CRITICAL DELAY: Vehicle {str(vehicle_id)[:8]} is delayed by approx. {delay_minutes} mins.",
            "timestamp": datetime.now().isoformat(),
            "priority": "high"
        }
