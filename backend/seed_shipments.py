import asyncio
import uuid
import random
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.models import DeliveryPoint, Shipment, Parcel, ShipmentLog
from app.services.security_service import SecurityService

async def seed_shipments():
    print("--- SEEDING SHIPMENTS AND PARCELS ---")
    async with AsyncSessionLocal() as session:
        # 1. Fetch pending delivery points
        result = await session.execute(select(DeliveryPoint).where(DeliveryPoint.status == "pending"))
        pending_points = result.scalars().all()

        if not pending_points:
            print("No pending delivery points found. Run seed_locations.py and seed_fleet.py first.")
            return

        for dp in pending_points:
            # 2. Skip if already linked to a shipment
            if dp.shipment_id:
                print(f"Skipping {dp.name} (already has shipment)")
                continue

            # 3. Create Shipment
            tracking_id = f"RTX-{uuid.uuid4().hex[:8].upper()}"
            priority = random.choice(["low", "medium", "high", "critical"])
            print(f"Creating Shipment {tracking_id} for {dp.name}")
            
            db_shipment = Shipment(
                tracking_id=tracking_id,
                priority=priority,
                status="created"
            )
            session.add(db_shipment)
            await session.flush() # Get ID

            # 4. Create 1-3 Parcels
            total_weight = 0
            for i in range(random.randint(1, 4)):
                weight = random.uniform(5, 50)
                total_weight += weight
                db_parcel = Parcel(
                    shipment_id=db_shipment.id,
                    weight_kg=weight,
                    length_cm=random.uniform(10, 50),
                    width_cm=random.uniform(10, 50),
                    height_cm=random.uniform(10, 50),
                    category=random.choice(["Electronics", "Pharma", "General", "Food"]),
                    is_hazardous=random.random() < 0.1,
                    is_fragile=random.random() < 0.2
                )
                session.add(db_parcel)

            # 5. Link to DeliveryPoint and update demand
            dp.shipment_id = db_shipment.id
            dp.demand_kg = total_weight
            
            # 6. Record initial log
            data = {
                "shipment_id": str(db_shipment.id),
                "status": "created",
                "location_lat": None,
                "location_lng": None,
                "timestamp": db_shipment.created_at.isoformat() if db_shipment.created_at else "",
                "index": 0,
                "metadata": {}
            }
            log_hash = SecurityService.generate_hash(data, "0" * 64)
            db_log = ShipmentLog(
                shipment_id=db_shipment.id,
                status="created",
                index=0,
                previous_hash="0" * 64,
                log_hash=log_hash,
                metadata_json={}
            )
            session.add(db_log)

        await session.commit()
    print("--- SHIPMENT SEED COMPLETE ---")

if __name__ == "__main__":
    asyncio.run(seed_shipments())
