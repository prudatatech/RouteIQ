import httpx
import asyncio

async def test_urls():
    base_variants = [
        "https://www.roadcast.in/api",
        "https://api.roadcast.in",
        "https://roadcast.in/api"
    ]
    endpoints = ["/v1/auth/login", "/auth/login", "/user/login", "/v1/user/login"]
    
    async with httpx.AsyncClient() as client:
        for base in base_variants:
            for ep in endpoints:
                url = f"{base}{ep}"
                try:
                    r = await client.post(url, json={"username": "test"}, timeout=5.0)
                    print(f"URL {url}: {r.status_code}")
                except Exception as e:
                    print(f"URL {url}: Error {str(e)}")

if __name__ == "__main__":
    asyncio.run(test_urls())
