import asyncio
import uuid
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.models import Depot, DeliveryPoint, Vehicle

async def seed_fleet():
    async with AsyncSessionLocal() as db:

        # 1. Create Depot if not exists
        result = await db.execute(select(Depot).limit(1))
        depot = result.scalar_one_or_none()
        if not depot:
            depot = Depot(
                id=uuid.UUID('00000000-0000-0000-0000-000000000001'),
                name="Central Fulfillment Center",
                address="Sector 62, Noida, Uttar Pradesh 201309",
                latitude=28.6256,
                longitude=77.3764
            )
            db.add(depot)
            print("Created Depot.")

        # 2. Create Delivery Points
        points = [
            {"name": "RLS Pharma Noida", "addr": "Sector 18, Noida", "lat": 28.5700, "lng": 77.3200, "cargo": ["cold_chain"]},
            {"name": "Indian Oil Depot", "addr": "Okhla Phase III, Delhi", "lat": 28.5400, "lng": 77.2800, "cargo": ["hazardous"]},
            {"name": "DLF Cyber City", "addr": "Cyber City, Gurugram, Haryana", "lat": 28.4950, "lng": 77.0878, "cargo": ["general"]},
            {"name": "Connaught Place", "addr": "Connaught Place, New Delhi", "lat": 28.6328, "lng": 77.2197, "cargo": ["general"]},
            {"name": "Select CITYWALK", "addr": "Saket District Centre, New Delhi", "lat": 28.5287, "lng": 77.2191, "cargo": ["general"]},
            {"name": "Max Healthcare", "addr": "Saket, New Delhi", "lat": 28.5270, "lng": 77.2140, "cargo": ["cold_chain"]},
            {"name": "Akshardham Temple", "addr": "Noida Link Rd, New Delhi", "lat": 28.6127, "lng": 77.2773, "cargo": ["general"]},
        ]
        
        for pt in points:
            res = await db.execute(select(DeliveryPoint).where(DeliveryPoint.name == pt["name"]))
            if not res.scalar_one_or_none():
                dp = DeliveryPoint(
                    name=pt["name"],
                    address=pt["addr"],
                    latitude=pt["lat"],
                    longitude=pt["lng"],
                    status="pending",
                    demand_kg=20.0,
                    required_cargo_types=pt["cargo"]
                )
                db.add(dp)
                print(f"Created specialized DP: {pt['name']}")

        # 3. Create Vehicles
        v_data = [
            {"plate": "DL-1C-FR-0001", "type": "truck", "cap": 1500, "cargo": ["cold_chain", "general"]},
            {"plate": "DL-1C-HZ-9999", "type": "truck", "cap": 2000, "cargo": ["hazardous"]},
            {"plate": "DL-1C-GN-5678", "type": "van", "cap": 800, "cargo": ["general"]},
            {"plate": "HR-26-BK-1111", "type": "bike", "cap": 50, "cargo": ["general"]},
        ]
        
        for vd in v_data:
            res = await db.execute(select(Vehicle).where(Vehicle.plate_number == vd["plate"]))
            if not res.scalar_one_or_none():
                v = Vehicle(
                    plate_number=vd["plate"],
                    vehicle_type=vd["type"],
                    capacity_kg=vd["cap"],
                    status="available",
                    cargo_types=vd["cargo"]
                )
                db.add(v)
                print(f"Created specialized Vehicle: {vd['plate']}")

        await db.commit()
        print("Fleet seeding complete.")

if __name__ == "__main__":
    asyncio.run(seed_fleet())
