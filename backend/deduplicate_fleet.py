import asyncio
from app.core.database import AsyncSessionLocal
from app.models.models import Vehicle
from sqlalchemy import select, delete

async def deduplicate_fleet():
    async with AsyncSessionLocal() as db:
        async with db.begin():
            r = await db.execute(select(Vehicle).order_by(Vehicle.created_at))
            vv = r.scalars().all()
            
            seen_plates = set()
            to_delete = []
            
            for v in vv:
                if v.plate_number in seen_plates:
                    print(f"To Delete Duplicate: {v.plate_number} (ID: {v.id})")
                    to_delete.append(v.id)
                else:
                    seen_plates.add(v.plate_number)
            
            if to_delete:
                await db.execute(delete(Vehicle).where(Vehicle.id.in_(to_delete)))
                print(f"Successfully deleted {len(to_delete)} duplicate vehicles.")
            else:
                print("No duplicate vehicles found to delete.")

if __name__ == "__main__":
    asyncio.run(deduplicate_fleet())
