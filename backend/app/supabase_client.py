"""Supabase client wrapper and utility functions.

Provides a thin abstraction over the `supabase-py` client for:
- Authentication (sign_up, sign_in, verify_token)
- Storage (upload_file, download_file)

The client is instantiated at import time using environment variables
`SUPABASE_URL` and `SUPABASE_ANON_KEY`. Ensure these are set in the
`.env` before the application starts.
"""

import os
from typing import Any, Dict, Optional

from supabase import create_client, Client

# Initialise Supabase client from environment variables
_SUPABASE_URL = os.getenv("SUPABASE_URL")
_SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")

if not _SUPABASE_URL or not _SUPABASE_ANON_KEY:
    raise EnvironmentError("SUPABASE_URL and SUPABASE_ANON_KEY must be set in the environment")

supabase: Client = create_client(_SUPABASE_URL, _SUPABASE_ANON_KEY)

# ---------- Authentication helpers ----------

def sign_up(email: str, password: str) -> Dict[str, Any]:
    """Create a new user in Supabase Auth.
    Returns the full Supabase response dict. Errors are raised as exceptions.
    """
    return supabase.auth.sign_up(email=email, password=password)


def sign_in(email: str, password: str) -> Dict[str, Any]:
    """Sign in a user and return the session data (access/refresh tokens)."""
    return supabase.auth.sign_in_with_password(email=email, password=password)


def verify_token(access_token: str) -> Dict[str, Any]:
    """Verify a JWT access token via Supabase.
    This is a thin wrapper around ``supabase.auth.get_user`` which fetches
    the user record associated with the token. If the token is invalid an
    exception will be raised.
    """
    return supabase.auth.get_user(access_token)

# ---------- Storage helpers ----------

def upload_file(bucket: str, path: str, file_bytes: bytes, content_type: Optional[str] = None) -> Dict[str, Any]:
    """Upload a file to a Supabase storage bucket.
    Parameters:
    - ``bucket``: The bucket name (must already exist).
    - ``path``: Path inside the bucket (e.g., ``"images/logo.png"``).
    - ``file_bytes``: Binary content of the file.
    - ``content_type``: Optional MIME type.
    """
    storage = supabase.storage()
    return storage.from_(bucket).upload(path, file_bytes, file_options={"contentType": content_type} if content_type else None)


def download_file(bucket: str, path: str) -> bytes:
    """Download a file from a Supabase storage bucket and return its bytes."""
    storage = supabase.storage()
    response = storage.from_(bucket).download(path)
    return response.content
