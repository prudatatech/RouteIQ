
class WeatherService:
    """
    Integrates with OpenWeather API for real-time condition data.
    """
    OPENWEATHER_URL = "http://api.weatherapi.com/v1/current.json"

    @staticmethod
    async def get_weather(lat: float, lng: float) -> str:
        """
        Mock weather severity for demo.
        Provides random conditions based on lat/lng hash for consistency.
        """
        # Pseudo-random consistency
        score = (abs(lat) + abs(lng)) % 10
        if score > 8:
            return "storm"
        if score > 6:
            return "rain"
        return "clear"

    @staticmethod
    async def get_delay_factor(condition: str) -> float:
        """
        Returns a time multiplier based on weather severity.
        """
        factors = {
            "clear": 1.0,
            "rain": 1.2,
            "storm": 1.5,
            "heavy_snow": 2.0
        }
        return factors.get(condition, 1.0)
