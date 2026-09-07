"""m4 topic stage：topic 区 + 各阶段状态 + 存量数据迁移

Revision ID: c3d9f1a02b47
Revises: a98ff6f65060
Create Date: 2026-09-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c3d9f1a02b47'
down_revision: Union[str, Sequence[str], None] = 'a98ff6f65060'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema and data."""
    # PG12+ 允许事务内 ALTER TYPE ... ADD VALUE，但同一事务内不得使用新值
    # （报 unsafe use of new value）。autocommit_block 让枚举变更立即提交，
    # 后续 UPDATE 在新事务中即可安全引用新值。
    # IF NOT EXISTS：downgrade 不回收枚举值，保证 up→down→up 循环幂等。
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE assetzone ADD VALUE IF NOT EXISTS 'topic'")
        op.execute("ALTER TYPE assetstatus ADD VALUE IF NOT EXISTS 'available'")
        op.execute("ALTER TYPE assetstatus ADD VALUE IF NOT EXISTS 'candidate'")
        op.execute("ALTER TYPE assetstatus ADD VALUE IF NOT EXISTS 'researching'")
        op.execute("ALTER TYPE assetstatus ADD VALUE IF NOT EXISTS 'approved'")
        op.execute("ALTER TYPE assetstatus ADD VALUE IF NOT EXISTS 'shelved'")

    # 存量数据迁移（M4 全局约束规则）：
    # 1) source 区且路径前缀为 选题策划/ 的资产 → topic 区 candidate；
    # 2) 其余 source 资产 → available（zone 不变）。
    op.execute(
        "UPDATE assets SET zone = 'topic', status = 'candidate' "
        "WHERE zone = 'source' AND source_path LIKE '选题策划/%'"
    )
    op.execute("UPDATE assets SET status = 'available' WHERE zone = 'source'")


def downgrade() -> None:
    """Downgrade data（枚举值不回收，见下）。"""
    # 数据回迁：topic 区整区迁回 source，状态恢复为历史词汇 topic。
    # （assetstatus 的 'topic' 值保留未删，回迁可直接引用。）
    op.execute(
        "UPDATE assets SET zone = 'source', status = 'topic' WHERE zone = 'topic'"
    )
    # 枚举新值（zone 'topic'；status 'available'/'candidate'/'researching'/
    # 'approved'/'shelved'）不删除：PostgreSQL 不支持安全 DROP VALUE
    # （枚举值一旦提交即无法移除，PG16 亦然），残留值无害；
    # models.py 同步保留词汇注释以示兼容。
