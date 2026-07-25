import asyncio
import random
import httpx

# Configuration
API_URL = "http://localhost:8000/api/v1"
VEHICLE_IDS = [] # To be populated

async def get_vehicles():
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{API_URL}/vehicles")
            return response.json()
    except Exception as e:
        print(f"Error fetching vehicles: {e}")
        return []

async def simulate_vehicle(vehicle_id):
    # Base location (Delhi/NCR area for demonstration)
    lat, lng = 28.6139 + random.uniform(-0.1, 0.1), 77.2090 + random.uniform(-0.1, 0.1)
    
    while True:
        # Move slightly
        lat += random.uniform(-0.001, 0.001)
        lng += random.uniform(-0.001, 0.001)
        
        telemetry = {
            "vehicle_id": vehicle_id,
            "latitude": lat,
            "longitude": lng,
            "speed_kmph": random.uniform(20, 80),
            "heading": random.uniform(0, 360),
            "fuel_level_pct": random.uniform(10, 100),
            "engine_temp": random.uniform(80, 100),
            "odometer_km": random.uniform(1000, 50000)
        }
        
        try:
            async with httpx.AsyncClient() as client:
                await client.post(f"{API_URL}/telemetry", json=telemetry)
                print(f"Telemetery sent for {vehicle_id}")
        except Exception as e:
            print(f"Failed to send telemetry for {vehicle_id}: {e}")
            
        await asyncio.sleep(5) # Sim every 5 seconds

async def main():
    vehicles = await get_vehicles()
    if not vehicles:
        print("No vehicles found. Seed the database first.")
        return
        
    tasks = [simulate_vehicle(v['id']) for v in vehicles[:10]]
    await asyncio.gather(*tasks)

if __name__ == "__main__":
    asyncio.run(main())
