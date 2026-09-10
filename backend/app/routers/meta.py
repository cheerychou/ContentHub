"""平台常量与统计只读端点：前端删硬编码，运行时拉取单一来源。"""
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..cover_specs import COVER_SPECS, PUBLISH_ENTRY_URLS
from ..db import get_db
from ..models import Asset, AssetStatus, AssetZone, Recipe
from ..speech import VOICES

router = APIRouter(prefix="/api/meta", tags=["meta"])


@router.get("/platforms")
def platforms() -> dict:
    """封面规格键（有序）/ 基础平台发布页 URL / 音色表（展示名 → edge-tts 值）。"""
    return {
        "cover": sorted(COVER_SPECS),
        "entry_urls": PUBLISH_ENTRY_URLS,
        "voices": VOICES,
    }


@router.get("/stats")
def stats(db: Session = Depends(get_db)) -> dict:
    """资产 zone×status 聚合 + 模板/提示词总数（驾驶舱与侧边栏徽标数据源）。

    四个区恒返回（空区 total: 0）；仅计数 > 0 的状态出现在区字典里。
    """
    zones: dict[str, dict[str, int]] = {z.value: {"total": 0} for z in AssetZone}
    total = 0
    rows = db.execute(
        select(Asset.zone, Asset.status, func.count()).group_by(Asset.zone, Asset.status)
    ).all()
    for zone, status, count in rows:
        entry = zones[AssetZone(zone).value]
        entry["total"] += count
        entry[AssetStatus(status).value] = count
        total += count
    recipes = db.scalar(select(func.count()).select_from(Recipe)) or 0
    return {"total": total, "zones": zones, "recipes": recipes}
