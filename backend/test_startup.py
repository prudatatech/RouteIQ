import sys
import os
import asyncio
sys.path.append(os.getcwd())

async def test():
    try:
        from app.core.database import engine, Base
        from app.core.redis import redis_client
        
        print("Starting manual lifespan test...")
        
        # 1. DB
        print("Checking DB...")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        print("DB ok.")
        
        # 2. Redis
        print("Checking Redis...")
        await redis_client.ping()
        print("Redis ok.")
        
        print("Manual lifespan test success!")
    except Exception:
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test())
