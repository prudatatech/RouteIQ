"""JWT authentication and password hashing utilities.

Verifies Supabase-issued JWTs using SUPABASE_JWT_SECRET.
Falls back to legacy SECRET_KEY for backward compatibility.

Supabase JWT payload structure:
  sub: user UUID
  role: "authenticated" (Supabase role, NOT app role)
  user_metadata: { full_name, role, phone }  ← app role is here
  aud: "authenticated"
"""
from datetime import datetime, timedelta, timezone
from typing import Optional, Union

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.core.config import settings
from app.schemas.auth import TokenData

bearer_scheme = HTTPBearer()


def _get_jwt_secret() -> str:
    """Prefer SUPABASE_JWT_SECRET, fall back to legacy SECRET_KEY."""
    return settings.SUPABASE_JWT_SECRET or settings.SECRET_KEY


def hash_password(password: str) -> str:
    """Hash a password using bcrypt. DEPRECATED — Supabase Auth handles passwords now."""
    import bcrypt
    pw_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(pw_bytes, salt)
    return hashed.decode('utf-8')


def verify_password(plain: Union[str, bytes], hashed: Union[str, bytes]) -> bool:
    """Verify a password against a hash using bcrypt. DEPRECATED."""
    try:
        import bcrypt
        if isinstance(plain, str):
            plain = plain.encode('utf-8')
        if isinstance(hashed, str):
            hashed = hashed.encode('utf-8')
        return bcrypt.checkpw(plain, hashed)
    except Exception:
        return False


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, _get_jwt_secret(), algorithm=settings.ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, _get_jwt_secret(), algorithm=settings.ALGORITHM)


def decode_token(token: str) -> TokenData:
    """Decode and verify a JWT (Supabase-issued or server-issued).

    Extracts user_id from `sub` and app role from `user_metadata.role`.
    Falls back to legacy SECRET_KEY if SUPABASE_JWT_SECRET verification fails.
    """
    secret = _get_jwt_secret()

    try:
        payload = jwt.decode(token, secret, algorithms=[settings.ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

        # App role: check user_metadata.role (Supabase), then top-level role (legacy)
        user_metadata = payload.get("user_metadata", {}) or {}
        role = user_metadata.get("role")
        if not role:
            top_role = payload.get("role", "driver")
            role = top_role if top_role != "authenticated" else "driver"

        return TokenData(user_id=user_id, role=role)

    except JWTError:
        # If SUPABASE_JWT_SECRET is set, try fallback to legacy SECRET_KEY
        if settings.SUPABASE_JWT_SECRET and settings.SUPABASE_JWT_SECRET != settings.SECRET_KEY:
            try:
                payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
                user_id = payload.get("sub")
                if user_id is None:
                    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

                user_metadata = payload.get("user_metadata", {}) or {}
                role = user_metadata.get("role") or payload.get("role", "driver")
                return TokenData(user_id=user_id, role=role)
            except JWTError:
                pass

        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> TokenData:
    return decode_token(credentials.credentials)


def require_role(*roles: str):
    """Dependency factory for role-based access control."""
    async def role_checker(token_data: TokenData = Depends(get_current_user)) -> TokenData:
        # Superadmin has access to everything
        if token_data.role == "superadmin":
            return token_data
            
        if token_data.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{token_data.role}' not authorized. Required: {roles}",
            )
        return token_data
    return role_checker
