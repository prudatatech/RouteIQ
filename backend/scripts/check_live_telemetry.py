
import asyncio
import sys
import os
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, func

# Add parent directory to path to import app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import AsyncSessionLocal
from app.models.models import Telemetry, Vehicle

async def check_telemetry():
    async with AsyncSessionLocal() as db:
        # Check target vehicles
        v_result = await db.execute(select(Vehicle).where(Vehicle.plate_number.in_(['HR38AC-1276', 'HR38AC-1658'])))
        vehicles = v_result.scalars().all()
        
        print("--- Vehicle Sync Status ---")
        for v in vehicles:
            # Count telemetry in last 5 mins
            t_result = await db.execute(
                select(func.count(Telemetry.id))
                .where(Telemetry.vehicle_id == v.id)
                .where(Telemetry.timestamp >= datetime.now(timezone.utc) - timedelta(minutes=5))
            )
            count = t_result.scalar()
            print(f"Vehicle: {v.plate_number}")
            print(f"  Last Sync: {v.last_sync}")
            print(f"  Telemetry Ingested (last 5 min): {count}")
            
if __name__ == "__main__":
    asyncio.run(check_telemetry())
