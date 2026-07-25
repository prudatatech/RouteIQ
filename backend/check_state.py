import asyncio
from app.core.database import AsyncSessionLocal
from app.models.models import Depot, Vehicle, DeliveryPoint
from sqlalchemy import select, func

async def run():
    async with AsyncSessionLocal() as s:
        depots = (await s.execute(select(Depot))).scalars().all()
        print('=== DEPOTS ===')
        for d in depots:
            print(f'  {d.id}: {d.name}')
        if not depots:
            print('  NO DEPOTS FOUND!')

        vc = (await s.execute(select(func.count(Vehicle.id)))).scalar()
        av = (await s.execute(select(func.count(Vehicle.id)).where(Vehicle.status == 'available'))).scalar()
        print(f'=== VEHICLES: {vc} total, {av} available ===')
        
        # Print first 3 vehicles
        vs = (await s.execute(select(Vehicle).limit(3))).scalars().all()
        for v in vs:
            print(f'  {v.id}: {v.plate_number} ({v.status})')

        dc = (await s.execute(select(func.count(DeliveryPoint.id)))).scalar()
        dp_pending = (await s.execute(select(func.count(DeliveryPoint.id)).where(DeliveryPoint.status == 'pending'))).scalar()
        print(f'=== DELIVERY POINTS: {dc} total, {dp_pending} pending ===')

asyncio.run(run())
