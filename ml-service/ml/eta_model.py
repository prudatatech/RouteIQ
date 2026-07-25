"""
ETA Prediction Model using XGBoost / LightGBM.
Features: distance, traffic density, weather, hour-of-day, day-of-week,
          historical delay patterns, vehicle type.
"""
from __future__ import annotations

import logging
import math
import pickle
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger("routeiq.eta")

MODEL_PATH = Path(__file__).parent / "eta_model.pkl"


def _build_features(
    distance_km: float,
    traffic_density: float,
    weather_severity: float,
    hour: int,
    day_of_week: int,
    vehicle_type_enc: int,
    historical_avg_speed: float,
) -> np.ndarray:
    """
    Feature vector for ETA model:
    [distance, traffic, weather, hour_sin, hour_cos, dow_sin, dow_cos,
     is_peak, vehicle_type, hist_speed, dist_sq, traffic_x_dist]
    """
    hour_sin = math.sin(2 * math.pi * hour / 24)
    hour_cos = math.cos(2 * math.pi * hour / 24)
    dow_sin = math.sin(2 * math.pi * day_of_week / 7)
    dow_cos = math.cos(2 * math.pi * day_of_week / 7)
    is_peak = 1 if hour in range(8, 11) or hour in range(17, 21) else 0

    return np.array([[
        distance_km,
        traffic_density,
        weather_severity,
        hour_sin,
        hour_cos,
        dow_sin,
        dow_cos,
        is_peak,
        vehicle_type_enc,
        historical_avg_speed,
        distance_km ** 2,
        traffic_density * distance_km,
    ]])


class ETAPredictor:
    """
    Wraps a trained XGBoost/LightGBM model for real-time ETA prediction.
    Falls back to physics-based estimate when no trained model is available.
    """

    VEHICLE_TYPE_MAP = {"truck": 0, "van": 1, "car": 2, "bike": 3}
    MODEL_VERSION = "1.0.0-physics"

    def __init__(self):
        self.model = self._load_model()

    def _load_model(self):
        if MODEL_PATH.exists():
            try:
                with open(MODEL_PATH, "rb") as f:
                    model = pickle.load(f)
                logger.info("ETA model loaded from disk")
                return model
            except Exception as e:
                logger.warning(f"Failed to load ETA model: {e}")
        logger.info("No trained ETA model found — using physics baseline")
        return None

    def predict(
        self,
        distance_km: float,
        traffic_density: float = 0.5,
        weather_severity: float = 0.0,
        vehicle_type: str = "truck",
        historical_avg_speed_kmph: float = 45.0,
        timestamp: Optional[datetime] = None,
    ) -> dict:
        """
        Returns predicted ETA with confidence intervals.

        traffic_density: 0 (clear) to 1 (gridlock)
        weather_severity: 0 (clear) to 1 (severe)
        """
        ts = timestamp or datetime.now(timezone.utc)
        hour = ts.hour
        dow = ts.weekday()
        vtype_enc = self.VEHICLE_TYPE_MAP.get(vehicle_type, 0)

        if self.model is not None:
            features = _build_features(
                distance_km, traffic_density, weather_severity,
                hour, dow, vtype_enc, historical_avg_speed_kmph,
            )
            predicted_minutes = float(self.model.predict(features)[0])
        else:
            predicted_minutes = self._physics_estimate(
                distance_km, traffic_density, weather_severity,
                hour, historical_avg_speed_kmph,
            )

        # Uncertainty: widen CI with traffic and weather
        uncertainty = max(2.0, predicted_minutes * 0.1 * (1 + traffic_density + weather_severity))

        # Break down impacts
        base_minutes = distance_km / historical_avg_speed_kmph * 60
        traffic_impact = predicted_minutes - base_minutes - (weather_severity * 5)
        weather_impact = weather_severity * 5

        return {
            "estimated_minutes": round(predicted_minutes, 1),
            "confidence_interval_low": round(predicted_minutes - uncertainty, 1),
            "confidence_interval_high": round(predicted_minutes + uncertainty, 1),
            "traffic_impact_minutes": round(max(0, traffic_impact), 1),
            "weather_impact_minutes": round(max(0, weather_impact), 1),
            "model_version": self.MODEL_VERSION,
        }

    def _physics_estimate(
        self,
        distance_km: float,
        traffic_density: float,
        weather_severity: float,
        hour: int,
        base_speed: float,
    ) -> float:
        """Physics-based fallback: adjust speed by traffic, weather, time-of-day."""
        # Speed reduction factors
        traffic_factor = 1 - (traffic_density * 0.6)       # up to 60% speed reduction
        weather_factor = 1 - (weather_severity * 0.3)       # up to 30%
        peak_factor = 0.75 if hour in range(8, 11) or hour in range(17, 21) else 1.0

        effective_speed = base_speed * traffic_factor * weather_factor * peak_factor
        effective_speed = max(5.0, effective_speed)  # minimum 5 km/h

        return (distance_km / effective_speed) * 60


# Singleton
eta_predictor = ETAPredictor()
