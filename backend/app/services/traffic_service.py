
class TrafficService:
    """
    Integrates with Mapbox Traffic API for real-time congestion data.
    """
    MAPBOX_TRAFFIC_URL = "https://api.mapbox.com/v4/mapbox.mapbox-streets-v8,mapbox.mapbox-terrain-v2/tilequery/"

    @staticmethod
    async def get_traffic_density(lat: float, lng: float) -> str:
        """
        Mock traffic density provider for demo.
        Provides random congestion based on lat/lng hash for consistency.
        """
        # Pseudo-random consistency
        score = (abs(lat) + abs(lng)) % 10
        if score > 8:
            return "high"
        if score > 5:
            return "medium"
        return "low"

    @staticmethod
    async def get_delay_factor(status: str) -> float:
        """
        Returns a time multiplier based on traffic status.
        """
        factors = {
            "low": 1.0,
            "medium": 1.15,
            "high": 1.4,
            "critical": 2.0
        }
        return factors.get(status, 1.0)
