import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, HttpUrl

from .models import AssetStatus, AssetZone, RecipeKind


class RecipeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: RecipeKind
    name: str
    description: str | None = None
    content: str
    meta: dict
    created_by: str
    created_at: datetime
    updated_at: datetime


class RecipeCreate(BaseModel):
    kind: RecipeKind
    name: str
    description: str | None = None
    content: str
    meta: dict = {}
    created_by: str = "zhoudabo"


class RecipeUpdate(BaseModel):
    kind: RecipeKind | None = None
    name: str | None = None
    description: str | None = None
    content: str | None = None
    meta: dict | None = None


class AssetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    zone: AssetZone
    status: AssetStatus
    title: str
    file_name: str | None = None
    content_type: str
    object_key: str | None = None
    source_url: str | None = None
    text_content: str | None = None
    created_by: str
    reviewed_by: str | None = None
    published_url: str | None = None
    published_at: datetime | None = None
    meta: dict
    created_at: datetime
    updated_at: datetime


class DerivationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_asset_id: uuid.UUID
    derived_asset_id: uuid.UUID
    recipe_ref: str | None = None
    note: str | None = None
    created_by: str
    created_at: datetime


class AssetDetail(AssetOut):
    upstream: list[DerivationOut] = []
    downstream: list[DerivationOut] = []
    file_url: str | None = None


class AssetExternalCreate(BaseModel):
    zone: Literal[AssetZone.SOURCE]
    title: str
    source_url: HttpUrl
    meta: dict = {}


class DeriveTextCreate(BaseModel):
    recipe_id: uuid.UUID
    title: str
    instructions: str | None = None


class StatusUpdate(BaseModel):
    status: AssetStatus


class PublishInfoUpdate(BaseModel):
    """发布登记：回填 published_url（自动记录时间）；clear=true 清空重登。"""

    published_url: HttpUrl | None = None
    clear: bool = False


class DerivationCreate(BaseModel):
    source_asset_id: uuid.UUID
    recipe_ref: str | None = None
    note: str | None = None
