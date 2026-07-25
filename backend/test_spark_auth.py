import httpx
import asyncio

async def test():
    base = 'https://api.roadcast.in/v1'
    creds = {'username': '9899977259', 'password': 'Demo12345'}
    for ep in ['/auth/login', '/user/login', '/login']:
        try:
            async with httpx.AsyncClient() as client:
                r = await client.post(base + ep, json=creds, timeout=10.0)
                print(f'EP {ep}: {r.status_code} - {r.text[:100]}')
        except Exception as e:
            print(f'EP {ep}: Error {str(e)}')

if __name__ == "__main__":
    asyncio.run(test())
