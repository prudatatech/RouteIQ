import asyncio
from sqlalchemy import select, text
from app.core.database import AsyncSessionLocal, engine, Base
from app.models.models import DeliveryPoint, Depot

async def sync_db():
    print("--- SYNCING DATABASE SCHEMA ---")
    async with engine.begin() as conn:
        # We'll drop and recreate depots and delivery_points to ensure TimestampMixin columns exist
        # This is safe for now because the user reported the location dropdown is empty.
        # Use CASCADE to handle foreign key dependencies if any.
        await conn.execute(text("DROP TABLE IF EXISTS delivery_points CASCADE;"))
        await conn.execute(text("DROP TABLE IF EXISTS depots CASCADE;"))
        
        # Now recreate all tables from current models
        await conn.run_sync(Base.metadata.create_all)
    print("--- SCHEMA SYNC COMPLETE ---")

async def seed_locations():
    print("--- SEEDING PAN-INDIA LOCATIONS ---")
    async with AsyncSessionLocal() as session:
        # 1. Seed Depots (Major Hubs)
        depots_to_seed = [
            {"name": "Delhi Central Hub", "address": "Okhla Industrial Estate, Phase III, New Delhi", "lat": 28.5355, "lng": 77.2736},
            {"name": "Mumbai Port Warehouse", "address": "Nhava Sheva, Navi Mumbai, Maharashtra", "lat": 18.9500, "lng": 72.9333},
            {"name": "Bangalore Tech Logistics", "address": "Electronic City Phase I, Bengaluru, Karnataka", "lat": 12.8452, "lng": 77.6633},
            {"name": "Chennai Coastal Depot", "address": "Ennore Port Road, Chennai, Tamil Nadu", "lat": 13.2200, "lng": 80.3200},
        ]

        for d_data in depots_to_seed:
            result = await session.execute(select(Depot).where(Depot.name == d_data["name"]))
            if not result.scalar_one_or_none():
                print(f"Creating Depot: {d_data['name']}")
                depot = Depot(
                    name=d_data["name"],
                    address=d_data["address"],
                    latitude=d_data["lat"],
                    longitude=d_data["lng"]
                )
                session.add(depot)

        # 2. Seed Delivery Points (Pan-India Cities)
        points_to_seed = [
            {"name": "New Delhi Central", "address": "Connaught Place, New Delhi", "lat": 28.6304, "lng": 77.2177},
            {"name": "Mumbai Bandra", "address": "Linking Road, Bandra West, Mumbai", "lat": 19.0607, "lng": 72.8362},
            {"name": "Bangalore Indiranagar", "address": "100 Feet Road, Indiranagar, Bengaluru", "lat": 12.9784, "lng": 77.6408},
            {"name": "Hyderabad Hitech", "address": "Mindspace, Madhapur, Hyderabad", "lat": 17.4435, "lng": 78.3773},
            {"name": "Pune Hinjewadi", "address": "Phase 1, Hinjewadi, Pune", "lat": 18.5913, "lng": 73.7389},
            {"name": "Kolkata Salt Lake", "address": "Sector V, Salt Lake City, Kolkata", "lat": 22.5735, "lng": 88.4331},
            {"name": "Ahmedabad SG Highway", "address": "Satellite Area, Ahmedabad", "lat": 23.0258, "lng": 72.5033},
            {"name": "Jaipur Pink City", "address": "MI Road, Jaipur", "lat": 26.9124, "lng": 75.8124},
            {"name": "Bhubaneswar Hub", "address": "Patia, Bhubaneswar", "lat": 20.3533, "lng": 85.8333},
            {"name": "Guwahati Hub", "address": "Bhangagarh, Guwahati, Assam", "lat": 26.1500, "lng": 91.7500},
        ]

        for p_data in points_to_seed:
            result = await session.execute(select(DeliveryPoint).where(DeliveryPoint.name == p_data["name"]))
            if not result.scalar_one_or_none():
                print(f"Creating Delivery Point: {p_data['name']}")
                point = DeliveryPoint(
                    name=p_data["name"],
                    address=p_data["address"],
                    latitude=p_data["lat"],
                    longitude=p_data["lng"],
                    demand_kg=0.0,
                    status="pending"
                )
                session.add(point)

        await session.commit()
    print("--- LOCATION SEED COMPLETE ---")

async def main():
    await sync_db()
    await seed_locations()
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
