"""add_conflict_type_columns

Revision ID: c8d9e0f1a2b3
Revises: 6ecf4d9d0094
Create Date: 2026-08-01 01:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c8d9e0f1a2b3'
down_revision: Union[str, Sequence[str], None] = '6ecf4d9d0094'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('pages', sa.Column('conflict_type', sa.String(), nullable=True))
    op.add_column('pages', sa.Column('conflict_type_confidence', sa.Float(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('pages', 'conflict_type_confidence')
    op.drop_column('pages', 'conflict_type')
