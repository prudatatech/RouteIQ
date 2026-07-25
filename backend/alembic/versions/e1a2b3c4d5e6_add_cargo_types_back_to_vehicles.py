"""add_cargo_types_back_to_vehicles

Revision ID: e1a2b3c4d5e6
Revises: d619b51920ae
Create Date: 2026-06-20 01:28:00.000000

cargo_types was removed in d619b51920ae but the SQLAlchemy model still defines it.
This migration re-adds the column to all tables that reference it.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'e1a2b3c4d5e6'
down_revision: Union[str, None] = 'd619b51920ae'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add cargo_types back to vehicles (was dropped in previous migration but model still has it)
    op.execute("""
        ALTER TABLE vehicles 
        ADD COLUMN IF NOT EXISTS cargo_types JSONB DEFAULT '[]'::jsonb;
    """)

    # These tables had cargo_types in the original schema too
    op.execute("""
        ALTER TABLE telemetry 
        ADD COLUMN IF NOT EXISTS cargo_types JSONB DEFAULT '[]'::jsonb;
    """)
    op.execute("""
        ALTER TABLE vehicle_stoppages 
        ADD COLUMN IF NOT EXISTS cargo_types JSONB DEFAULT '[]'::jsonb;
    """)


def downgrade() -> None:
    op.drop_column('vehicle_stoppages', 'cargo_types')
    op.drop_column('telemetry', 'cargo_types')
    op.drop_column('vehicles', 'cargo_types')
