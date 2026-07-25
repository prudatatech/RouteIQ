"""
Dynamic Re-Optimization Engine
Monitors active routes and triggers re-routing when delay thresholds are exceeded.
"""
from __future__ import annotations

import logging
import uuid
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.redis import cache_get, cache_set
from app.ml.vrp_solver import Location, VehicleConfig, solve_vrp_ortools
from app.models.models import Route, RouteStop

logger = logging.getLogger("routeiq.reroute")

REROUTE_DELAY_THRESHOLD_MINUTES = 8   # reroute if delay > 8 min (tightened for better ROI)
REROUTE_COOLDOWN_SECONDS = 300          # don't reroute same vehicle for 5 min


@dataclass
class TrafficEvent:
    event_id: str
    lat: float
    lng: float
    radius_km: float
    severity: float          # 0-1
    event_type: str          # "jam", "accident", "closure", "weather"
    started_at: datetime


@dataclass
class RerouteDecision:
    vehicle_id: str
    route_id: str
    trigger: str
    old_eta_minutes: float
    new_eta_minutes: float
    saved_minutes: float
    new_stop_sequence: List[str]
    rerouted_at: datetime


class DynamicRerouteEngine:
    """
    Listens for traffic/weather events and decides whether to reroute active vehicles.
    """

    def __init__(self):
        self._active_events: List[TrafficEvent] = []

    async def process_traffic_event(self, db: AsyncSession, event: TrafficEvent) -> List[RerouteDecision]:
        """Called when a new traffic event is received."""
        self._active_events.append(event)
        decisions = []

        affected_routes = await self._find_affected_routes(db, event)

        for route_id, vehicle_id, remaining_stops, current_eta in affected_routes:
            if await self._is_on_cooldown(str(vehicle_id)):
                logger.debug(f"Vehicle {vehicle_id} on cooldown, skipping")
                continue

            # Fetch current position
            from app.models.models import Telemetry
            tele_res = await db.execute(
                select(Telemetry)
                .where(Telemetry.vehicle_id == vehicle_id)
                .order_by(Telemetry.timestamp.desc())
                .limit(1)
            )
            tele = tele_res.scalar_one_or_none()
            start_loc = Location(
                id=str(vehicle_id),
                lat=tele.latitude if tele else event.lat,
                lng=tele.longitude if tele else event.lng
            )

            decision = await self._reroute_vehicle(
                vehicle_id=str(vehicle_id),
                route_id=str(route_id),
                remaining_stops=remaining_stops,
                current_eta=current_eta,
                event=event,
                start_location=start_loc,
            )

            if decision:
                decisions.append(decision)
                await self._set_cooldown(str(vehicle_id))

        return decisions

    async def _find_affected_routes(self, db: AsyncSession, event: TrafficEvent) -> List[Tuple[uuid.UUID, uuid.UUID, List[Location], float]]:
        """
        Returns list of (route_id, vehicle_id, remaining_stops, eta_minutes)
        for routes that pass within event.radius_km of the event location.
        """
        # 1. Fetch active routes with their pending stops
        result = await db.execute(
            select(Route)
            .where(Route.status == "active")
            .options(selectinload(Route.stops).selectinload(RouteStop.delivery_point))
        )
        active_routes = result.scalars().all()
        
        affected = []
        for route in active_routes:
            # Simple radial filter: are any pending stops within radius_km?
            pending_stops = [s for s in route.stops if s.status == "pending"]
            if not pending_stops:
                continue

            is_affected = False
            for stop in pending_stops:
                dp = stop.delivery_point
                dist = self._haversine_distance(event.lat, event.lng, dp.latitude, dp.longitude)
                if dist <= event.radius_km:
                    is_affected = True
                    break
            
            if is_affected:
                locations = [
                    Location(
                        id=str(s.delivery_point_id),
                        lat=s.delivery_point.latitude,
                        lng=s.delivery_point.longitude,
                        demand_kg=s.delivery_point.demand_kg
                    )
                    for s in sorted(pending_stops, key=lambda x: x.sequence)
                ]
                affected.append((route.id, route.vehicle_id, locations, route.total_duration_minutes))
                
        return affected

    def _haversine_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        R = 6371  # Earth radius in km
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return R * c

    async def _reroute_vehicle(
        self,
        vehicle_id: str,
        route_id: str,
        remaining_stops: List[Location],
        current_eta: float,
        event: TrafficEvent,
        start_location: Location,
    ) -> Optional[RerouteDecision]:
        """Re-solve VRP for remaining stops, avoiding congested area."""
        if len(remaining_stops) < 1:
            return None
            
        # Prepend start location as depot (index 0)
        locations = [start_location] + remaining_stops

        # Simulate re-optimization with traffic factor
        traffic_multiplier = 1 + event.severity * 1.5  # up to 150% slowdown

        # Use the existing solver to find a better sequence
        solution = solve_vrp_ortools(
            locations=locations,
            vehicles=[VehicleConfig(id=vehicle_id, capacity_kg=9999, start_location=locations[0])],
            max_solve_seconds=5,
            traffic_factor=traffic_multiplier,
        )

        if not solution.routes:
            return None

        new_route = solution.routes[0]
        new_eta = new_route.total_duration_minutes

        if current_eta - new_eta < REROUTE_DELAY_THRESHOLD_MINUTES:
            logger.debug(f"Reroute for {vehicle_id} saves only {current_eta - new_eta:.1f} min, skipping")
            return None

        return RerouteDecision(
            vehicle_id=vehicle_id,
            route_id=route_id,
            trigger=f"{event.event_type.upper()} detected nearby",
            old_eta_minutes=current_eta,
            new_eta_minutes=new_eta,
            saved_minutes=round(current_eta - new_eta, 1),
            new_stop_sequence=new_route.stop_ids,
            rerouted_at=datetime.now(timezone.utc),
        )

    async def _is_on_cooldown(self, vehicle_id: str) -> bool:
        key = f"reroute_cooldown:{vehicle_id}"
        return await cache_get(key) is not None

    async def _set_cooldown(self, vehicle_id: str) -> None:
        key = f"reroute_cooldown:{vehicle_id}"
        await cache_set(key, "1", ttl=REROUTE_COOLDOWN_SECONDS)

    async def manual_scan(self, db: AsyncSession, vehicle_id_or_plate: str) -> Optional[RerouteDecision]:
        """
        Runs a re-optimization scan for a specific vehicle by its UUID or Plate Number.
        """
        from app.models.models import Vehicle, Route
        import uuid

        # 1. Resolve vehicle_id (handle both Plate Number and UUID)
        target_uid: Optional[uuid.UUID] = None
        try:
            target_uid = uuid.UUID(vehicle_id_or_plate)
        except ValueError:
            # If not a UUID, look up by plate number (robust handling)
            clean_input = vehicle_id_or_plate.replace("-", "").upper()
            v_res = await db.execute(
                select(Vehicle).where(
                    func.replace(Vehicle.plate_number, '-', '').ilike(clean_input)
                )
            )
            vehicle = v_res.scalar_one_or_none()
            if vehicle:
                target_uid = vehicle.id
            else:
                logger.warning(f"Could not resolve vehicle identifier: {vehicle_id_or_plate}")
                return None

        # 2. Find the active/pending route for this vehicle
        result = await db.execute(
            select(Route)
            .where(Route.vehicle_id == target_uid)
            .where(Route.status.in_(["active", "pending"]))
            .options(selectinload(Route.stops).selectinload(RouteStop.delivery_point))
        )
        route = result.scalar_one_or_none()
        if not route:
            logger.debug(f"No active or pending route found for vehicle {vehicle_id_or_plate}")
            return None

        pending_stops = [s for s in route.stops if s.status == "pending"]
        if len(pending_stops) < 2:
            return None

        # 3. Latest telemetry
        from app.models.models import Telemetry
        tele_result = await db.execute(
            select(Telemetry)
            .where(Telemetry.vehicle_id == target_uid)
            .order_by(Telemetry.timestamp.desc())
            .limit(1)
        )
        tele = tele_result.scalar_one_or_none()

        # Use a descriptive trigger message
        trigger_msg = "Manual incubation scan"
        if tele:
            # If we have real telemetry, we can check if they're moving
            if tele.speed_kmph < 5:
                trigger_msg = "Detected stationary vehicle on active route"
            else:
                trigger_msg = "Heuristic route efficiency scan"
        
        start_loc = Location(
            id=str(target_uid),
            lat=tele.latitude if tele else (pending_stops[0].delivery_point.latitude if pending_stops else 0.0),
            lng=tele.longitude if tele else (pending_stops[0].delivery_point.longitude if pending_stops else 0.0)
        )

        locations = [
            Location(
                id=str(s.delivery_point_id),
                lat=s.delivery_point.latitude,
                lng=s.delivery_point.longitude,
                demand_kg=s.delivery_point.demand_kg
            )
            for s in sorted(pending_stops, key=lambda x: x.sequence)
        ]

        # Use a nominal traffic event to trigger the existing logic
        mock_event = TrafficEvent(
            event_id="manual_scan",
            lat=start_loc.lat,
            lng=start_loc.lng,
            radius_km=1.0,
            severity=0.1,
            event_type="incubation",
            started_at=datetime.now(timezone.utc)
        )

        decision = await self._reroute_vehicle(
            vehicle_id=str(target_uid),
            route_id=str(route.id),
            remaining_stops=locations,
            current_eta=route.total_duration_minutes,
            event=mock_event,
            start_location=start_loc
        )
        
        if decision:
            decision.trigger = trigger_msg
            
        return decision


# Singleton
reroute_engine = DynamicRerouteEngine()
