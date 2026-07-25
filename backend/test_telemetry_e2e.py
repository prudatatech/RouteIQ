import httpx
import asyncio

async def test_sim():
    # 1. Login to get token (telemetry script didn't do this)
    auth_url = "http://localhost:8000/api/v1/auth/login"
    login_data = {"email": "superadmin@routeiq.com", "password": "Super@123"}
    
    async with httpx.AsyncClient() as client:
        r_auth = await client.post(auth_url, json=login_data, timeout=10.0)
        token = r_auth.json().get('access_token')
        headers = {"Authorization": f"Bearer {token}"}
        
        # 2. Get Vehicles
        print("Fetching vehicles...")
        r_veh = await client.get("http://localhost:8000/api/v1/vehicles", headers=headers)
        if r_veh.status_code != 200:
            print(f"Failed to fetch vehicles: {r_veh.text}")
            return
            
        vehicles = r_veh.json()
        print(f"Found {len(vehicles)} vehicles.")
        if not vehicles:
            return
            
        # 3. Send Telemetry for the first vehicle
        vid = vehicles[0]['id']
        telemetry = {
            "vehicle_id": vid,
            "latitude": 28.6139,
            "longitude": 77.2090,
            "speed_kmph": 45.0,
            "heading": 90.0,
            "fuel_level_pct": 80.0,
            "engine_temp": 90.0,
            "odometer_km": 15000.0
        }
        print(f"Sending telemetry for {vid}...")
        r_tel = await client.post("http://localhost:8000/api/v1/telemetry", json=telemetry, headers=headers)
        print(f"Telemetry Status: {r_tel.status_code}")

if __name__ == "__main__":
    asyncio.run(test_sim())
