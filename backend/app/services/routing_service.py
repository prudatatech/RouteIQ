import httpx
from typing import List, Tuple

class RoutingService:
    """
    Handles route calculations using OSRM (Open Source Routing Machine).
    Dev: Uses public demo server.
    Prod: Recommended to self-host.
    """
    OSRM_DEMO_URL = "https://router.project-osrm.org/route/v1/driving/"

    @staticmethod
    async def get_route(waypoints: List[Tuple[float, float]]) -> dict:
        """
        Expects waypoints as [(lng, lat), ...].
        Returns distance (meters), duration (seconds), and geometry (polyline).
        """
        if len(waypoints) < 2:
            return {"distance": 0, "duration": 0, "geometry": ""}
            
        coords = ";".join([f"{w[0]},{w[1]}" for w in waypoints])
        url = f"{RoutingService.OSRM_DEMO_URL}{coords}?overview=full&geometries=polyline"
        
        async with httpx.AsyncClient() as client:
            response = await client.get(url)
            if response.status_code == 200:
                data = response.json()
                if "routes" in data and len(data["routes"]) > 0:
                    route = data["routes"][0]
                    return {
                        "distance": route["distance"],
                        "duration": route["duration"],
                        "geometry": route["geometry"]
                    }
        
        return {"distance": 0, "duration": 0, "geometry": "", "error": "OSRM Error"}
