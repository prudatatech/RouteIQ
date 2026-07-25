import asyncio
from app.core.database import AsyncSessionLocal
from app.models.models import Vehicle
from sqlalchemy import select

async def check():
    async with AsyncSessionLocal() as db:
        r = await db.execute(select(Vehicle))
        vv = r.scalars().all()
        print(f"Total vehicles: {len(vv)}")
        plates = {}
        for v in vv:
            print(f"Plate: {v.plate_number}, ID: {v.id}, Status: {v.status}")
            if v.plate_number in plates:
                plates[v.plate_number].append(str(v.id))
            else:
                plates[v.plate_number] = [str(v.id)]
        
        duplicates = {k: v for k, v in plates.items() if len(v) > 1}
        if duplicates:
            print(f"DUPLICATES FOUND: {duplicates}")
        else:
            print("No duplicate plate numbers found.")

if __name__ == "__main__":
    asyncio.run(check())
