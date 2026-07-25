import os
from functools import lru_cache
from dotenv import load_dotenv
from typing import List

load_dotenv()

# from pydantic_settings import BaseSettings


class Settings:
    # App
    APP_NAME: str = os.getenv("APP_NAME", "ROUTEIQ powered by PRUDATA TECHNOLOGIES")
    APP_ENV: str = os.getenv("APP_ENV", "development")
    DEBUG: bool = os.getenv("DEBUG", "False").lower() == "true"
    SECRET_KEY: str = os.getenv("SECRET_KEY", "temporary_secret_key_for_setup")
    ALGORITHM: str = os.getenv("ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
    REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

    # Supabase Auth
    SUPABASE_JWT_SECRET: str = os.getenv("SUPABASE_JWT_SECRET", "")


    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql+asyncpg://routeiq:routeiq_pass@127.0.0.1:1234/routeiq")
    DATABASE_POOL_SIZE: int = int(os.getenv("DATABASE_POOL_SIZE", "20"))
    DATABASE_MAX_OVERFLOW: int = int(os.getenv("DATABASE_MAX_OVERFLOW", "10"))

    # Redis
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://redis:6379/0")
    REDIS_CACHE_TTL: int = int(os.getenv("REDIS_CACHE_TTL", "300"))

    # Celery
    CELERY_BROKER_URL: str = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/1")
    CELERY_RESULT_BACKEND: str = os.getenv("CELERY_RESULT_BACKEND", "redis://redis:6379/2")

    # External APIs
    GOOGLE_MAPS_API_KEY: str = os.getenv("GOOGLE_MAPS_API_KEY", "")
    # Google OAuth
    DEFAULT_GOOGLE_ROLE: str = os.getenv("DEFAULT_GOOGLE_ROLE", "admin")
    OPENWEATHER_API_KEY: str = os.getenv("OPENWEATHER_API_KEY", "")
    TOMTOM_API_KEY: str = os.getenv("TOMTOM_API_KEY", "")
    MAPBOX_ACCESS_TOKEN: str = os.getenv("MAPBOX_ACCESS_TOKEN", "")
    ENABLE_MOBILE_GPS: bool = os.getenv("ENABLE_MOBILE_GPS", "false").lower() == "true"
    ENABLE_HARDWARE_SYNC: bool = os.getenv("ENABLE_HARDWARE_SYNC", "false").lower() == "true"

    # SparkGPS (Roadcast) Integration
    SPARK_GPS_API_URL: str = os.getenv("SPARK_GPS_API_URL", "https://api.roadcast.in/v1")
    SPARK_GPS_API_TOKEN: str = os.getenv("SPARK_GPS_API_TOKEN", "")
    SPARK_GPS_USERNAME: str = os.getenv("SPARK_GPS_USERNAME", "")
    SPARK_GPS_PASSWORD: str = os.getenv("SPARK_GPS_PASSWORD", "")


    # AWS
    AWS_REGION: str = os.getenv("AWS_REGION", "ap-south-1")
    AWS_S3_BUCKET: str = os.getenv("AWS_S3_BUCKET", "")

    # Optimization
    @property
    def TRAFFIC_FACTOR_MULTIPLIER(self) -> float:
        return float(os.getenv("TRAFFIC_FACTOR_MULTIPLIER", "0.6"))

    @property
    def WEATHER_FACTOR_MULTIPLIER(self) -> float:
        return float(os.getenv("WEATHER_FACTOR_MULTIPLIER", "0.4"))

    # CORS
    @property
    def ALLOWED_ORIGINS(self) -> List[str]:
        origins = os.getenv("ALLOWED_ORIGINS", "")
        if origins:
            return [o.strip() for o in origins.split(",")]
        # Default development origins
        return [
            "http://localhost:3000",
            "http://localhost:5173",
            "http://localhost:5174",
            "http://localhost:3005",
            "http://127.0.0.1:3005"
        ]

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
