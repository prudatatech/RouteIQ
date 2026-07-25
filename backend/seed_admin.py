import asyncio
import uuid
import sys
import os

# Ensure the backend directory is in the path
sys.path.append(os.getcwd())

from app.core.database import AsyncSessionLocal
from app.models.models import User
from app.core.security import hash_password

async def seed_admin():
    async with AsyncSessionLocal() as db:
        from sqlalchemy import select
        # Check if admin exists
        result = await db.execute(select(User).where(User.email == "admin@routeiq.io"))
        existing = result.scalar_one_or_none()
        
        if existing:
            print("Admin user already exists.")
            return

        # Create multiple roles for testing
        users = [
            User(
                id=uuid.uuid4(),
                email="superadmin@routeiq.io",
                full_name="Super Administrator",
                hashed_password=hash_password("SuperAdmin1234!"),
                role="superadmin",
                is_active=True
            ),
            User(
                id=uuid.uuid4(),
                email="admin@routeiq.io",
                full_name="Fleet Administrator",
                hashed_password=hash_password("Admin1234!"),
                role="admin",
                is_active=True
            ),
            User(
                id=uuid.uuid4(),
                email="manager@routeiq.io",
                full_name="Regional Manager",
                hashed_password=hash_password("Manager1234!"),
                role="manager",
                is_active=True
            ),
            User(
                id=uuid.uuid4(),
                email="driver@routeiq.io",
                full_name="Route Pilot",
                hashed_password=hash_password("Driver1234!"),
                role="driver",
                is_active=True
            )
        ]
        
        for u in users:
            db.add(u)
        
        await db.commit()
        print("Demo users created successfully with .io domains.")

if __name__ == "__main__":
    asyncio.run(seed_admin())
