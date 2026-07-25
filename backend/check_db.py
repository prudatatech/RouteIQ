import asyncio
from app.core.database import AsyncSessionLocal
from app.models.models import Depot, Vehicle, DeliveryPoint, Route
from sqlalchemy import select

async def check():
    async with AsyncSessionLocal() as s:
        d = (await s.execute(select(Depot))).scalars().all()
        v_avail = (await s.execute(select(Vehicle).where(Vehicle.status.in_(["available", "idle"])))).scalars().all()
        dp_pending = (await s.execute(select(DeliveryPoint).where(DeliveryPoint.status == "pending"))).scalars().all()
        routes = (await s.execute(select(Route))).scalars().all()
        print(f"Total Depots: {len(d)}")
        print(f"Available/Idle Vehicles: {len(v_avail)}")
        print(f"Pending DeliveryPoints: {len(dp_pending)}")
        print(f"Total Routes in DB: {len(routes)}")

if __name__ == "__main__":
    asyncio.run(check())
