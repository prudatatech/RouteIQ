import asyncio
import bcrypt
from sqlalchemy import select
from app.core.database import AsyncSessionLocal, engine
from app.models.models import User

async def seed_users():
    print("--- SEEDING USERS ---")
    async with AsyncSessionLocal() as session:
        users_to_seed = [
            {
                "email": "superadmin@routeiq.com",
                "full_name": "Platform Superadmin",
                "password": "Super@123",
                "role": "superadmin"
            },
            {
                "email": "admin@routeiq.com",
                "full_name": "Fleet Admin",
                "password": "Admin@123",
                "role": "admin"
            },
            {
                "email": "manager@routeiq.com",
                "full_name": "Fleet Manager",
                "password": "Manager@123",
                "role": "manager"
            },
            {
                "email": "driver@routeiq.com",
                "full_name": "John Driver",
                "password": "Driver@123",
                "role": "driver"
            }
        ]
        
        for u_data in users_to_seed:
            result = await session.execute(select(User).where(User.email == u_data["email"]))
            user = result.scalar_one_or_none()
            if not user:
                print(f"Creating user: {u_data['email']} ({u_data['role']})")
                hashed = bcrypt.hashpw(u_data["password"].encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
                user = User(
                    email=u_data["email"],
                    full_name=u_data["full_name"],
                    hashed_password=hashed,
                    role=u_data["role"],
                    is_active=True
                )
                session.add(user)
            else:
                print(f"User already exists: {u_data['email']}")
        
        await session.commit()
    print("--- USER SEED COMPLETE ---")

async def main():
    await seed_users()
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
