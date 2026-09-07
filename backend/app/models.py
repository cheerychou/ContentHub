import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AssetZone(str, enum.Enum):
    SOURCE = "source"    # 源料区（原子态）
    TOPIC = "topic"      # 选题区（选题工作台，M4）
    MASTER = "master"    # 母版区（编辑态）
    PUBLISH = "publish"  # 发布态（派生物）


class AssetStatus(str, enum.Enum):
    # 源料区
    AVAILABLE = "available"    # 可用源料（M4）
    # 选题区（M4）
    CANDIDATE = "candidate"      # 候选选题
    RESEARCHING = "researching"  # 调研中
    APPROVED = "approved"        # 已立项
    SHELVED = "shelved"          # 已搁置
    # 母版区 / 发布区
    TOPIC = "topic"            # 选题（历史词汇，仅存量数据保留）
    DRAFTING = "drafting"      # 创作中
    FINALIZED = "finalized"    # 定稿
    PUBLISHING = "publishing"  # 发布中
    PUBLISHED = "published"    # 已发布


# 各区合法状态词表（M4 四阶段工作台，PRD-MVP-001 v2.4）
ZONE_STATUSES: dict[AssetZone, set[AssetStatus]] = {
    AssetZone.SOURCE: {AssetStatus.AVAILABLE},
    AssetZone.TOPIC: {
        AssetStatus.CANDIDATE, AssetStatus.RESEARCHING,
        AssetStatus.APPROVED, AssetStatus.SHELVED,
    },
    # master 保留 publishing/published 仅为存量 14 篇已发布母版可读；
    # 新流转只允许 drafting⇄finalized。
    AssetZone.MASTER: {
        AssetStatus.DRAFTING, AssetStatus.FINALIZED,
        AssetStatus.PUBLISHING, AssetStatus.PUBLISHED,
    },
    AssetZone.PUBLISH: {AssetStatus.PUBLISHING, AssetStatus.PUBLISHED},
}

# 各区状态机（M4）：master 不再允许 finalized→publishing（发布资产由派生产生即 publishing）；
# source 无状态流转；publish 资产由派生产生即 publishing，此后仅可 published。
ZONE_TRANSITIONS: dict[AssetZone, dict[AssetStatus, set[AssetStatus]]] = {
    AssetZone.TOPIC: {
        AssetStatus.CANDIDATE: {AssetStatus.RESEARCHING, AssetStatus.SHELVED},
        AssetStatus.RESEARCHING: {AssetStatus.APPROVED, AssetStatus.SHELVED},
        AssetStatus.SHELVED: {AssetStatus.CANDIDATE},
        AssetStatus.APPROVED: set(),
    },
    AssetZone.SOURCE: {},
    AssetZone.MASTER: {
        AssetStatus.DRAFTING: {AssetStatus.FINALIZED},
        AssetStatus.FINALIZED: {AssetStatus.DRAFTING},
    },
    AssetZone.PUBLISH: {
        AssetStatus.PUBLISHING: {AssetStatus.PUBLISHED},
    },
}


class Asset(Base):
    __tablename__ = "assets"
    __table_args__ = (
        Index(
            "ix_assets_title_trgm",
            "title",
            postgresql_using="gin",
            postgresql_ops={"title": "gin_trgm_ops"},
        ),
        Index(
            "ix_assets_text_trgm",
            "text_content",
            postgresql_using="gin",
            postgresql_ops={"text_content": "gin_trgm_ops"},
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    zone: Mapped[AssetZone] = mapped_column(
        SAEnum(AssetZone, values_callable=lambda e: [m.value for m in e])
    )
    status: Mapped[AssetStatus] = mapped_column(
        SAEnum(AssetStatus, values_callable=lambda e: [m.value for m in e])
    )
    title: Mapped[str] = mapped_column(String(500))
    file_name: Mapped[str | None] = mapped_column(String(500))
    content_type: Mapped[str] = mapped_column(String(20), default="other")
    object_key: Mapped[str | None] = mapped_column(String(1000))
    source_url: Mapped[str | None] = mapped_column(String(2000))
    text_content: Mapped[str | None] = mapped_column(Text)
    source_path: Mapped[str | None] = mapped_column(String(1000), unique=True)
    created_by: Mapped[str] = mapped_column(String(100), default="zhoudabo")
    reviewed_by: Mapped[str | None] = mapped_column(String(100))
    meta: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    # 时区感知时间列（M1 修正）
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    # 发布登记（M1）：发布后回填
    published_url: Mapped[str | None] = mapped_column(String(2000))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # 该资产由谁派生而来（上游）
    upstream = relationship(
        "Derivation",
        foreign_keys="Derivation.derived_asset_id",
        back_populates="derived",
        cascade="all, delete-orphan",
    )
    # 该资产派生出什么（下游）
    downstream = relationship(
        "Derivation",
        foreign_keys="Derivation.source_asset_id",
        back_populates="source",
        cascade="all, delete-orphan",
    )


class Derivation(Base):
    __tablename__ = "derivations"
    __table_args__ = (
        UniqueConstraint("source_asset_id", "derived_asset_id", name="uq_derivation_pair"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    source_asset_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assets.id", ondelete="CASCADE")
    )
    derived_asset_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assets.id", ondelete="CASCADE")
    )
    recipe_ref: Mapped[str | None] = mapped_column(String(200))  # M1 配方预留
    note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str] = mapped_column(String(100), default="zhoudabo")
    # 时区感知时间列（M2 工程清偿修正，与 assets.created_at 一致）
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )

    source = relationship("Asset", foreign_keys=[source_asset_id], back_populates="downstream")
    derived = relationship("Asset", foreign_keys=[derived_asset_id], back_populates="upstream")


class RecipeKind(str, enum.Enum):
    COVER_TEMPLATE = "cover_template"  # 封面模板配方
    TEXT_PROMPT = "text_prompt"        # 文本提示词配方


class Recipe(Base):
    __tablename__ = "recipes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    kind: Mapped[RecipeKind] = mapped_column(
        SAEnum(RecipeKind, values_callable=lambda e: [m.value for m in e],
               name="recipekind")
    )
    name: Mapped[str] = mapped_column(String(200), unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    created_by: Mapped[str] = mapped_column(String(100), default="zhoudabo")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
