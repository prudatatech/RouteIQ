
import asyncio
from app.core.database import AsyncSessionLocal
from app.models.models import Vehicle
from sqlalchemy import select

async def check():
    plates = ['HR38AC-1276', 'HR38AC-1658']
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Vehicle).where(Vehicle.plate_number.in_(plates)))
        vehicles = result.scalars().all()
        for v in vehicles:
            print(f"FOUND: {v.plate_number} (ID: {v.id}, Status: {v.status})")
        
        missing = set(plates) - {v.plate_number for v in vehicles}
        for m in missing:
            print(f"MISSING: {m}")

if __name__ == "__main__":
    asyncio.run(check())
