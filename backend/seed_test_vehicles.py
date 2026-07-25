
import asyncio
import uuid
from app.core.database import AsyncSessionLocal
from app.models.models import Vehicle
from sqlalchemy import select

async def seed_test_vehicles():
    plates = ['HR38AC-1276', 'HR38AC-1658']
    async with AsyncSessionLocal() as session:
        for plate in plates:
            result = await session.execute(select(Vehicle).where(Vehicle.plate_number == plate))
            existing = result.scalar_one_or_none()
            if not existing:
                new_v = Vehicle(
                    id=uuid.uuid4(),
                    plate_number=plate,
                    vehicle_type='truck',
                    status='on_route',
                    latitude=28.5244,
                    longitude=77.2167
                )
                session.add(new_v)
                print(f"CREATED: {plate}")
            else:
                print(f"EXISTS: {plate}")
        
        await session.commit()

if __name__ == "__main__":
    asyncio.run(seed_test_vehicles())
