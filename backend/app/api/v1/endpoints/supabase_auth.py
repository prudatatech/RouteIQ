from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.supabase_client import sign_up, sign_in, verify_token

router = APIRouter()

class SupabaseAuthRequest(BaseModel):
    email: str
    password: str

@router.post("/supabase/signup", status_code=status.HTTP_201_CREATED)
async def supabase_signup(payload: SupabaseAuthRequest):
    try:
        result = sign_up(payload.email, payload.password)
        return {"message": "User created", "data": result}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

@router.post("/supabase/login")
async def supabase_login(payload: SupabaseAuthRequest):
    try:
        result = sign_in(payload.email, payload.password)
        # result contains access_token, refresh_token, user info etc.
        return {"message": "Login successful", "data": result}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))

@router.post("/supabase/verify")
async def supabase_verify(token: str):
    try:
        user = verify_token(token)
        return {"message": "Token valid", "user": user}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))
