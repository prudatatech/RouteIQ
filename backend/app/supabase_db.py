import os
from typing import Any, Dict, List, Optional

# Re‑use the client created in app.supabase_client
from app.supabase_client import supabase


class SupabaseDB:
    """Thin wrapper around the Supabase client for common CRUD operations.

    The wrapper is deliberately simple – it abstracts the repetitive
    ``supabase.from_(table)`` calls and provides a tiny async‑compatible
    façade that can be used from FastAPI routes.
    """

    def __init__(self, client= supabase):
        self.client = client

    # ----- Read -----------------------------------------------------------
    def select_one(self, table: str, pk: Any) -> Optional[Dict[str, Any]]:
        """Return a single row identified by ``pk`` (assumes column name ``id``)."""
        resp = (
            self.client.from_(table)
            .select("*")
            .eq("id", pk)
            .single()
            .execute()
        )
        return resp.data if resp.data else None

    def select_all(self, table: str, filters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Return all rows from *table* optionally filtered by equality conditions.

        ``filters`` is a mapping ``column -> value`` and will be chained with
        ``eq`` calls.
        """
        query = self.client.from_(table).select("*")
        if filters:
            for col, val in filters.items():
                query = query.eq(col, val)
        resp = query.execute()
        return resp.data or []

    # ----- Create ----------------------------------------------------------
    def insert(self, table: str, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Insert ``payload`` into ``table`` and return the inserted rows.
        ``payload`` can be a dict or a list of dicts.
        """
        resp = self.client.from_(table).insert(payload).execute()
        return resp.data or []

    # ----- Update ----------------------------------------------------------
    def update(self, table: str, pk: Any, changes: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Update a row identified by ``pk`` (``id`` column) with ``changes``.
        Returns the updated row(s).
        """
        resp = (
            self.client.from_(table)
            .update(changes)
            .eq("id", pk)
            .execute()
        )
        return resp.data or []

    # ----- Delete ----------------------------------------------------------
    def delete(self, table: str, pk: Any) -> List[Dict[str, Any]]:
        """Delete a row from ``table`` identified by ``pk`` (``id`` column)."""
        resp = self.client.from_(table).delete().eq("id", pk).execute()
        return resp.data or []


# Export a singleton that can be imported throughout the backend
supabase_db = SupabaseDB()
