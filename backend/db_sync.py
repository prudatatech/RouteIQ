import asyncio
from app.core.database import AsyncSessionLocal
from app.models.models import Vehicle, DeliveryPoint, Route, RouteStop
from sqlalchemy import update, delete

async def run():
    async with AsyncSessionLocal() as session:
        # 1. Clear old routes and stops to start fresh
        # Deleting stops first to avoid foreign key violations
        await session.execute(delete(RouteStop))
        await session.execute(delete(Route))
        print("Cleared all existing routes and stops.")

        # 2. Reset vehicles to 'available'
        await session.execute(update(Vehicle).values(status='available'))
        print("Reset all vehicles to 'available'.")

        # 3. Reset delivery points to 'pending'
        await session.execute(update(DeliveryPoint).values(status='pending'))
        print("Reset all delivery points to 'pending'.")

        await session.commit()
        print("Database sync complete. Ready for new optimization.")

if __name__ == "__main__":
    asyncio.run(run())
