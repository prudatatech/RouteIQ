import asyncio
from app.core.config import settings
from supabase import create_async_client

async def main():
    client = await create_async_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)
    try:
        res = await client.table("vehicles").select("*").execute()
        print(res.data)
    except Exception as e:
        print("ERROR:", type(e), e)

asyncio.run(main())
