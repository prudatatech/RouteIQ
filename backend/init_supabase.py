import asyncio
import sys
import os

# Ensure the backend directory is in the path
sys.path.append(os.getcwd())

from sqlalchemy import text
from app.core.database import engine, Base

async def init_db():
    print("--- ROBUST SUPABASE INITIALIZATION ---")
    async with engine.connect() as conn:
        # 1. Create Enums if they don't exist
        enums = [
            ("user_role", ["superadmin", "admin", "manager", "driver"]),
            ("vehicle_type", ["truck", "van", "bike", "car"]),
            ("vehicle_status", ["available", "on_route", "idle", "maintenance", "offline"]),
            ("route_status", ["pending", "optimizing", "active", "completed", "cancelled"]),
            ("alert_severity", ["low", "medium", "high", "critical"]),
            ("shipment_status", ["created", "picked_up", "in_transit", "delivered", "cancelled"]),
            ("shipment_priority", ["low", "medium", "high", "critical"]),
        ]
        
        for name, values in enums:
            try:
                val_str = ", ".join([f"'{v}'" for v in values])
                await conn.execute(text(f"CREATE TYPE {name} AS ENUM ({val_str});"))
                print(f"Created enum: {name}")
            except Exception as e:
                if "already exists" in str(e).lower():
                    print(f"Enum {name} already exists. Skipping.")
                else:
                    print(f"Error creating enum {name}: {e}")
        
        await conn.commit()

        # 2. Create Tables
        print("Creating tables...")
        await conn.run_sync(Base.metadata.create_all)
        await conn.commit()
        print("Tables created (if not exist).")

    print("--- INITIALIZATION COMPLETE ---")

async def main():
    try:
        await init_db()
    finally:
        await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
