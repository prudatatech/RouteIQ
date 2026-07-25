import httpx
import asyncio

async def test_auth():
    url = "http://localhost:8001/api/v1/auth/login"
    data = {"username": "superadmin@routeiq.com", "password": "Super@123"}
    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(url, data=data)
            print(f"Status: {r.status_code}")
            if r.status_code == 200:
                print(r.json().get("access_token"))
            else:
                print(r.text)
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_auth())
