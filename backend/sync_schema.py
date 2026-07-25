import asyncio
from sqlalchemy import text
from app.core.database import engine, Base

async def sync_schema():
    print("--- SYNCING FLEET INTELLIGENCE SCHEMA ---")
    async with engine.begin() as conn:
        # 1. Add new columns to existing tables using ALTER TABLE (PostgreSQL)
        # Vehicle: current_fuel_liters
        try:
            await conn.execute(text("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS current_fuel_liters FLOAT DEFAULT 60.0;"))
            print("Updated 'vehicles' table.")
        except Exception as e:
            print(f"Vehicles error: {e}")

        # Route: weather_condition, traffic_delay_minutes
        try:
            await conn.execute(text("ALTER TABLE routes ADD COLUMN IF NOT EXISTS weather_condition VARCHAR(50) DEFAULT 'clear';"))
            await conn.execute(text("ALTER TABLE routes ADD COLUMN IF NOT EXISTS traffic_delay_minutes INTEGER DEFAULT 0;"))
            print("Updated 'routes' table.")
        except Exception as e:
            print(f"Routes error: {e}")

        # 2. Create new tables if they don't exist
        await conn.run_sync(Base.metadata.create_all)
        print("Created new tables (VehicleStoppages, etc).")
        
    print("--- SCHEMA SYNC COMPLETE ---")

async def main():
    await sync_schema()
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
