"""平台常量只读端点：前端删硬编码，运行时拉取单一来源。"""
from fastapi import APIRouter

from ..cover_specs import COVER_SPECS, PUBLISH_ENTRY_URLS
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
