
import asyncio
import httpx
import json

async def test_auth():
    username = "9899977259"
    password = "Demo12345"
    url = "https://api.roadcast.in/v1/user/login" # Common endpoint for Roadcast
    
    payload = {
        "username": username,
        "password": password
    }
    
    print(f"Testing Auth at {url}...")
    async with httpx.AsyncClient() as client:
        try:
            # Different vendors have different login payloads. 
            # Trying common ones or checking SparkGPSService.py for the exact one.
            # SparkGPSService.py uses: /auth/login
            alt_url = "https://api.roadcast.in/v1/auth/login"
            
            resp = await client.post(alt_url, json=payload, timeout=10.0)
            print(f"Status: {resp.status_code}")
            if resp.status_code == 200:
                print("SUCCESS: Logged into SparkGPS")
                print(resp.json())
            else:
                print(f"FAILED: {resp.text}")
                
        except Exception as e:
            print(f"ERROR: {str(e)}")

if __name__ == "__main__":
    asyncio.run(test_auth())
