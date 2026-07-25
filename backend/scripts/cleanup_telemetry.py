import asyncio
from datetime import datetime, timedelta, timezone
from sqlalchemy import delete
from app.core.database import AsyncSessionLocal
from app.models.models import Telemetry

async def cleanup_telemetry(days_to_keep: int = 1):
    cutoff = datetime.now(timezone.utc) - timedelta(days=days_to_keep)
    print(f"Cleaning up telemetry data older than {cutoff}...")
    
    async with AsyncSessionLocal() as session:
        query = delete(Telemetry).where(Telemetry.timestamp < cutoff)
        result = await session.execute(query)
        await session.commit()
        print(f"Deleted {result.rowcount} stale telemetry records.")

if __name__ == "__main__":
    asyncio.run(cleanup_telemetry())
