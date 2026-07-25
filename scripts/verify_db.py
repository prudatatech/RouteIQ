import asyncio
from sqlalchemy import inspect
from app.core.database import engine, Base
# Import models to ensure they are registered with Base.metadata
from app.models.models import *

async def check():
    async with engine.connect() as conn:
        def get_tables(connection):
            return inspect(connection).get_table_names()
        
        tables = await conn.run_sync(get_tables)
        print("Registered models:", list(Base.metadata.tables.keys()))
        print("Existing tables in DB:", tables)

if __name__ == "__main__":
    asyncio.run(check())
