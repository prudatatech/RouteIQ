import httpx
import asyncio

async def login():
    url = "http://localhost:8001/api/v1/auth/login"
    data = {"username": "admin@routeiq.com", "password": "Admin@123"}
    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(url, data=data, timeout=10.0)
            if r.status_code == 200:
                print(r.json().get("access_token"))
            else:
                print(f"Login failed: {r.status_code} - {r.text}")
        except Exception as e:
            print(f"Error login: {str(e)}")

if __name__ == "__main__":
    asyncio.run(login())
