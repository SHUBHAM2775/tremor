"""add cluster_metadata table

Revision ID: c8924e868fb5
Revises: c8d9e0f1a2b3
Create Date: 2026-08-30 02:29:52.238784

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c8924e868fb5'
down_revision: Union[str, Sequence[str], None] = 'c8d9e0f1a2b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'cluster_metadata',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('last_recalculated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('cluster_metadata')
