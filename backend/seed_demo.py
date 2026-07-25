import os
import asyncio
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.models import User
from app.core.security import hash_password

async def seed_users():
    users_data = [
        {"email": "superadmin@routeiq.io", "full_name": "Chief Operations", "password": os.getenv("SEED_SUPERADMIN_PASSWORD", "SuperAdmin123!"), "role": "superadmin"},
        {"email": "admin@routeiq.io", "full_name": "Fleet Administrator", "password": os.getenv("SEED_ADMIN_PASSWORD", "Admin1234!"), "role": "admin"},
        {"email": "manager@routeiq.io", "full_name": "Station Manager", "password": os.getenv("SEED_MANAGER_PASSWORD", "Manager123!"), "role": "manager"},
        {"email": "driver@routeiq.io", "full_name": "Lokesh Kumar", "password": os.getenv("SEED_DRIVER_PASSWORD", "Driver123!"), "role": "driver"},
    ]

    async with AsyncSessionLocal() as session:
        for u_data in users_data:
            # Check if user exists
            result = await session.execute(select(User).where(User.email == u_data["email"]))
            user = result.scalar_one_or_none()

            if user:
                # Update existing user
                user.full_name = u_data["full_name"]
                user.hashed_password = hash_password(u_data["password"])
                user.role = u_data["role"]
                user.is_active = True
                print(f"Updated {u_data['role']}: {u_data['email']}")
            else:
                # Create new user
                new_user = User(
                    email=u_data["email"],
                    full_name=u_data["full_name"],
                    hashed_password=hash_password(u_data["password"]),
                    role=u_data["role"],
                    is_active=True
                )
                session.add(new_user)
                print(f"Created {u_data['role']}: {u_data['email']}")
        
        await session.commit()
        print("Seeding complete.")

if __name__ == "__main__":
    asyncio.run(seed_users())
