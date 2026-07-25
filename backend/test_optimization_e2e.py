import httpx
import asyncio
import json

async def test_optimization():
    auth_url = "http://localhost:8000/api/v1/auth/login"
    login_data = {"email": "superadmin@routeiq.com", "password": "Super@123"}
    
    async with httpx.AsyncClient() as client:
        # 1. Login
        r_auth = await client.post(auth_url, json=login_data, timeout=10.0)
        if r_auth.status_code != 200:
            print(f"Auth Failed: {r_auth.text}")
            return
            
        token = r_auth.json().get('access_token')
        print("Auth Successful.")
        
        # 2. Trigger Optimization
        opt_url = "http://localhost:8000/api/v1/optimize/"
        headers = {"Authorization": f"Bearer {token}"}
        
        # We'll use the fallback values defined in optimization.py by passing an empty payload
        payload = {
            "depot_id": "00000000-0000-0000-0000-000000000001", # Will trigger fallback to first depot
            "vehicle_ids": [],
            "delivery_point_ids": []
        }
        
        print("Triggering Optimization Engine...")
        r_opt = await client.post(opt_url, json=payload, headers=headers, timeout=60.0)
        print(f"Status: {r_opt.status_code}")
        
        if r_opt.status_code == 200:
            data = r_opt.json()
            routes = data.get("routes", [])
            print(f"SUCCESS: Generated {len(routes)} optimized routes.")
            for rt in routes:
                print(f" - Route {rt.get('id')} -> {len(rt.get('stops', []))} stops, {rt.get('total_distance_km')} km")
        else:
             print(f"Optimization Failed: {repr(r_opt.text)}")

if __name__ == "__main__":
    asyncio.run(test_optimization())
