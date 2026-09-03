import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Enum as SAEnum, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AssetZone(str, enum.Enum):
    SOURCE = "source"    # 源料区（原子态）
    MASTER = "master"    # 母版区（编辑态）
    PUBLISH = "publish"  # 发布态（派生物）


class AssetStatus(str, enum.Enum):
    TOPIC = "topic"            # 选题
    DRAFTING = "drafting"      # 创作中
    FINALIZED = "finalized"    # 定稿
    PUBLISHING = "publishing"  # 发布中
    PUBLISHED = "published"    # 已发布


# 状态机（PRD-MVP-001 v2.0 §5 M0）：定稿可返工，发布中可撤回，published 为终态
TRANSITIONS: dict[AssetStatus, set[AssetStatus]] = {
    AssetStatus.TOPIC: {AssetStatus.DRAFTING},
    AssetStatus.DRAFTING: {AssetStatus.FINALIZED},
    AssetStatus.FINALIZED: {AssetStatus.DRAFTING, AssetStatus.PUBLISHING},
    AssetStatus.PUBLISHING: {AssetStatus.FINALIZED, AssetStatus.PUBLISHED},
    AssetStatus.PUBLISHED: set(),
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
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

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
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    source = relationship("Asset", foreign_keys=[source_asset_id], back_populates="downstream")
    derived = relationship("Asset", foreign_keys=[derived_asset_id], back_populates="upstream")
