import asyncio
import sys
import os
import uuid

# Ensure the backend directory is in the path
sys.path.append(os.getcwd())

from app.core.database import AsyncSessionLocal, engine
from app.models.models import User, Depot, DeliveryPoint, Vehicle, Shipment
from app.core.security import hash_password
from sqlalchemy import select

async def seed_admin():
    print("Seeding admin users...")
    async with AsyncSessionLocal() as db:
        for u_data in [
            {"email": "superadmin@routeiq.io", "full_name": "Super Administrator", "password": "SuperAdmin1234!", "role": "superadmin"},
            {"email": "admin@routeiq.io", "full_name": "Fleet Administrator", "password": "Admin1234!", "role": "admin"},
            {"email": "manager@routeiq.io", "full_name": "Regional Manager", "password": "Manager1234!", "role": "manager"},
            {"email": "driver@routeiq.io", "full_name": "Route Pilot", "password": "Driver1234!", "role": "driver"}
        ]:
            result = await db.execute(select(User).where(User.email == u_data["email"]))
            if not result.scalar_one_or_none():
                db.add(User(
                    id=uuid.uuid4(),
                    email=u_data["email"],
                    full_name=u_data["full_name"],
                    hashed_password=hash_password(u_data["password"]),
                    role=u_data["role"],
                    is_active=True
                ))
        await db.commit()

async def seed_locations():
    print("Seeding locations...")
    async with AsyncSessionLocal() as db:
        depots = [
            {"name": "Delhi Central Hub", "address": "Okhla Industrial Estate, Phase III, New Delhi", "lat": 28.5355, "lng": 77.2736},
            {"name": "Mumbai Port Warehouse", "address": "Nhava Sheva, Navi Mumbai, Maharashtra", "lat": 18.9500, "lng": 72.9333}
        ]
        for d in depots:
            res = await db.execute(select(Depot).where(Depot.name == d["name"]))
            if not res.scalar_one_or_none():
                db.add(Depot(id=uuid.uuid4(), name=d["name"], address=d["address"], latitude=d["lat"], longitude=d["lng"]))
        
        points = [
            {"name": "Connaught Place Delivery", "address": "New Delhi", "lat": 28.6304, "lng": 77.2177},
            {"name": "Bandra Delivery Hub", "address": "Mumbai", "lat": 19.0607, "lng": 72.8362}
        ]
        for p in points:
            res = await db.execute(select(DeliveryPoint).where(DeliveryPoint.name == p["name"]))
            if not res.scalar_one_or_none():
                db.add(DeliveryPoint(id=uuid.uuid4(), name=p["name"], address=p["address"], latitude=p["lat"], longitude=p["lng"]))
        
        await db.commit()

async def main():
    print("--- COMPREHENSIVE SUPABASE SEEDING ---")
    try:
        await seed_admin()
        await seed_locations()
    except Exception as e:
        print(f"Error: {e}")
    finally:
        await engine.dispose()
        print("--- SEEDING DONE ---")

if __name__ == "__main__":
    asyncio.run(main())
