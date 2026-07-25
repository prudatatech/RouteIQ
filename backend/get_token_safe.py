import httpx
import asyncio

async def login():
    # Trying the internal exposed port 8000 that FastAPI usually runs on during local dev
    url = "http://localhost:8000/api/v1/auth/login"
    data = {"email": "superadmin@routeiq.com", "password": "Super@123"}
    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(url, json=data, timeout=10.0)
            if r.status_code == 200:
                print(f"TOKEN={r.json().get('access_token')}")
            else:
                print(f"Login failed: {r.status_code} - {r.text}")
        except Exception as e:
            print(f"Error login: {str(e)}")

if __name__ == "__main__":
    asyncio.run(login())
