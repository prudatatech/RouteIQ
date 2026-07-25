"""Add superadmin role

Revision ID: b74a1234cdef
Revises: 
Create Date: 2026-03-22 17:45:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b74a1234cdef'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Postgres Enum update
    op.execute("ALTER TYPE user_role ADD VALUE 'superadmin'")


def downgrade() -> None:
    # Downgrading Enums in Postgres is hard (cannot remove values without recreation)
    # Since this is a new role, we just won't use it.
    pass
