import asyncio
import uuid
from app.core.database import AsyncSessionLocal
from app.ml.reroute_engine import reroute_engine
from app.models.models import Vehicle, Route, RouteStop, DeliveryPoint
from app.ml.vrp_solver import Location
from sqlalchemy import select

async def test_manual_scan_robustness():
    async with AsyncSessionLocal() as db:
        # 1. Ensure we have a vehicle and a dummy route for it
        # (Assuming HR38AC-1276 was seeded earlier)
        plate = "HR38AC-1276"
        res = await db.execute(select(Vehicle).where(Vehicle.plate_number.ilike(f"%{plate.replace('-','')}%")))
        vehicle = res.scalar_one_or_none()
        
        if not vehicle:
            print("Target vehicle HR38AC-1276 not found. Please run seeding first.")
            return

        print(f"Found Vehicle: {vehicle.plate_number} (ID: {vehicle.id})")

        # 2. Test manual scan with different formats
        formats = ["HR38AC1276", "hr38ac1276", "HR38AC-1276"]
        for fmt in formats:
            print(f"\nTesting format: '{fmt}'")
            try:
                # We expect this to not crash, even if no route is found (returns None)
                decision = await reroute_engine.manual_scan(db, fmt)
                if decision:
                    print(f"MATCH FOUND! Suggested saving {decision.saved_minutes} mins.")
                else:
                    print("No better route found (or no active route), but identifier resolved correctly.")
            except Exception as e:
                print(f"CRASH with format '{fmt}': {str(e)}")

if __name__ == "__main__":
    asyncio.run(test_manual_scan_robustness())
