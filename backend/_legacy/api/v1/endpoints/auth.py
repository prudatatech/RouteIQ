"""Authentication endpoints."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from google.oauth2 import id_token
from google.auth.transport import requests
import os

from ....core.database import get_db
from ....core.security import (
    create_access_token, create_refresh_token,
    decode_token, hash_password, verify_password,
)
from ....models.models import User
from ....schemas.schemas import LoginRequest, TokenResponse, UserCreate, UserResponse

router = APIRouter()

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")


@router.post("/register", response_model=UserResponse, status_code=201)
async def register(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == payload.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()
    
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    user.last_login = datetime.now(timezone.utc)

    token_data = {"sub": str(user.id), "role": str(user.role)}
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
        role=str(user.role),
        user_id=user.id,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: dict, db: AsyncSession = Depends(get_db)):
    token = body.get("refresh_token")
    if not token:
        raise HTTPException(status_code=400, detail="refresh_token required")

    token_data = decode_token(token)
    result = await db.execute(select(User).where(User.id == token_data.user_id))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    td = {"sub": str(user.id), "role": str(user.role)}
    return TokenResponse(
        access_token=create_access_token(td),
        refresh_token=create_refresh_token(td),
        role=str(user.role),
        user_id=user.id,
    )



@router.post("/logout")
async def logout():
    # With JWT, logout is handled client-side (discard tokens)
    # For full revocation: add token to Redis blocklist
    return {"message": "Logged out successfully"}


@router.post("/google", response_model=TokenResponse)
async def google_login(payload: dict, db: AsyncSession = Depends(get_db)):
    """
    Exchanges a Google ID Token for a system JWT.
    """
    token = payload.get("id_token")
    if not token:
        raise HTTPException(status_code=400, detail="id_token required")

    # Development shortcut: allow a static test token for local testing without Google verification
    if token == "test-token":
        # Simulated user data
        email = "test@example.com"
        full_name = "Test User"
    else:
        try:
            # Specify the CLIENT_ID of the app that accesses the backend:
            idinfo = id_token.verify_oauth2_token(token, requests.Request(), GOOGLE_CLIENT_ID)
            # ID token is valid. Get the user's Google Account ID from the decoded token.
            email = idinfo["email"]
            full_name = idinfo.get("name", "Google User")
        except ValueError:
            # Invalid token
            raise HTTPException(status_code=401, detail="Invalid Google token")

    # Check if user exists
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if not user:
        # Auto-register Google users as drivers or customers by default
        user = User(
            email=email,
            full_name=full_name,
            hashed_password=hash_password(os.urandom(16).hex()), # Random password
            # Assign a default role for new Google users. Superadmin can change later.
            role=os.getenv("DEFAULT_GOOGLE_ROLE", "admin"),  # Default to 'admin' if not set
            is_active=True
        )
        db.add(user)
        await db.flush()
        await db.refresh(user)

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

    user.last_login = datetime.now(timezone.utc)

    token_data = {"sub": str(user.id), "role": str(user.role)}
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
        role=str(user.role),
        user_id=user.id,
    )
