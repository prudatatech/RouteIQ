import asyncio
import random
import time
import httpx
import logging
import sys
import os

# Ensure the backend app directory is in the path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import AsyncSessionLocal
from app.models.models import Vehicle

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("stress_test")

# Configuration
API_URL = "http://localhost:8001/api/v1"
ADMIN_EMAIL = "admin@routeiq.io"
ADMIN_PASSWORD = "Admin1234!"
FLEET_SIZE = 50 
UPDATE_INTERVAL = 2.0 
DURATION_SECONDS = 300 

async def ensure_fleet_exists():
    """Seed specialized vehicles directly into DB if empty."""
    async with AsyncSessionLocal() as db:
        from sqlalchemy import select, func
        # Fixed the mangled placeholders
        count_query = select(func.count(Vehicle.id))
        count = await db.scalar(count_query)
        
        if count >= 10:
            logger.info(f"Fleet already exists ({count} vehicles). Skipping seeding.")
            return

        logger.info(f"Seeding {FLEET_SIZE} specialized vehicles...")
        cargo_options = ["general", "cold_chain", "hazardous"]
        types = ["truck", "van", "bike"]

        for i in range(FLEET_SIZE):
            v = Vehicle(
                plate_number=f"SIM-{1000 + i}",
                vehicle_type=random.choice(types),
                capacity_kg=random.randint(500, 5000),
                status="available",
                cargo_types=[random.choice(cargo_options)]
            )
            db.add(v)
        
        await db.commit()
        logger.info("Fleet seeding complete.")

async def login(client: httpx.AsyncClient):
    """Authenticate and return JWT token."""
    logger.info(f"Logging in as {ADMIN_EMAIL}...")
    try:
        # Use JSON payload with 'email' to match Pydantic schema
        resp = await client.post(f"{API_URL}/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if resp.status_code == 200:
            token = resp.json()["access_token"]
            return token
        else:
            logger.error(f"Login failed: {resp.status_code} {resp.text}")
            return None
    except Exception as e:
        logger.error(f"Login error: {e}")
        return None

async def simulate_vehicle(client: httpx.AsyncClient, vehicle_id: str, headers: dict):
    # Noida Delhi NCR Base
    lat, lng = 28.5355, 77.3910
    lat += random.uniform(-0.1, 0.1)
    lng += random.uniform(-0.1, 0.1)
    
    start_time = time.time()
    while time.time() - start_time < DURATION_SECONDS:
        lat += random.uniform(-0.0005, 0.0005)
        lng += random.uniform(-0.0005, 0.0005)
        
        payload = {
            "vehicle_id": vehicle_id,
            "latitude": lat,
            "longitude": lng,
            "speed_kmph": random.uniform(20, 90),
            "heading": random.uniform(0, 360),
            "fuel_level_pct": random.uniform(10, 100), # Required field
            "engine_temp": random.uniform(80, 110),
            "odometer_km": random.uniform(1000, 50000)
        }
        
        try:
            # Use telemetry endpoint with token
            await client.post(f"{API_URL}/telemetry/", json=payload, headers=headers)
        except Exception as e:
            logger.error(f"Telemetry error for {vehicle_id}: {e}")
            
        await asyncio.sleep(UPDATE_INTERVAL * random.uniform(0.8, 1.2))

async def run_stress_test():
    # 1. Ensure Data exists
    await ensure_fleet_exists()

    async with httpx.AsyncClient(timeout=10) as client:
        # 2. Login
        token = await login(client)
        if not token:
            return
        
        headers = {"Authorization": f"Bearer {token}"}

        # 3. Fetch fleet
        logger.info("Fetching fleet IDs...")
        try:
            resp = await client.get(f"{API_URL}/vehicles/", headers=headers)
            vehicles = resp.json()
            vehicle_list = vehicles if isinstance(vehicles, list) else vehicles.get("items", [])
        except Exception as e:
            logger.error(f"API Error: {e}")
            return

        active_vehicles = vehicle_list[:FLEET_SIZE]
        logger.info(f"Stressing with {len(active_vehicles)} vehicles...")

        tasks = [simulate_vehicle(client, v['id'], headers) for v in active_vehicles]
        await asyncio.gather(*tasks)

if __name__ == "__main__":
    try:
        asyncio.run(run_stress_test())
    except KeyboardInterrupt:
        logger.info("Test stopped.")
