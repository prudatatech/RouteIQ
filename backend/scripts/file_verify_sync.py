
import asyncio
import sys
import os
from sqlalchemy import select

# Add parent directory to path to import app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import AsyncSessionLocal
from app.models.models import Vehicle

async def verify():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Vehicle).where(Vehicle.plate_number.in_(['HR38AC-1276', 'HR38AC-1658'])))
        vehicles = result.scalars().all()
        
        with open("sync_report.txt", "w") as f:
            f.write(f"Found {len(vehicles)} target vehicles.\n")
            for v in vehicles:
                f.write(f"Vehicle: {v.plate_number}, Last Sync: {v.last_sync}, Status: {v.status}\n")

if __name__ == "__main__":
    asyncio.run(verify())
