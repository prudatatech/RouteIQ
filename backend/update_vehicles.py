import asyncio
from app.core.database import AsyncSessionLocal
from app.models.models import Vehicle
from sqlalchemy import update

async def run():
    async with AsyncSessionLocal() as session:
        # Set all vehicles to 'available' to ensure they can be used for optimization
        # and discovered by the incubator for existing routes.
        await session.execute(update(Vehicle).values(status='available'))
        await session.commit()
        print("Success: All vehicles have been set to 'available' status.")

if __name__ == "__main__":
    asyncio.run(run())
