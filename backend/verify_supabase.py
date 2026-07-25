import asyncio
import sys
import os

# Ensure the backend directory is in the path
sys.path.append(os.getcwd())

from sqlalchemy import text
from app.core.database import AsyncSessionLocal, engine

async def verify():
    print("--- VERIFYING SUPABASE CONNECTION ---")
    try:
        async with AsyncSessionLocal() as session:
            # Check tables
            result = await session.execute(
                text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
            )
            tables = [row[0] for row in result.fetchall()]
            print(f"Tables found: {', '.join(tables)}")
            
            # Check users
            result = await session.execute(text("SELECT count(*) FROM users"))
            user_count = result.scalar()
            print(f"User count: {user_count}")
            
    except Exception as e:
        print(f"Verification error: {e}")
    finally:
        await engine.dispose()

if __name__ == "__main__":
    asyncio.run(verify())
