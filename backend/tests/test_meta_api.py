"""meta 端点：平台常量单一来源（cover 规格键 / 发布页跳转 URL / 音色表）+ 资产统计聚合。"""
import pytest
from fastapi.testclient import TestClient

from app.cover_specs import COVER_SPECS, PUBLISH_ENTRY_URLS
from app.db import get_db
from app.main import app
from app.models import Asset, AssetStatus, AssetZone, Recipe, RecipeKind
from app.speech import VOICES


@pytest.fixture()
def client(db_session):
    """meta 统计走 DB：复用全局 db_session 覆盖 get_db（与 test_assets_api 同模式）。"""
    app.dependency_overrides[get_db] = lambda: (yield db_session)
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_meta_platforms_three_keys():
    client = TestClient(app)
    resp = client.get("/api/meta/platforms")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {"cover", "entry_urls", "voices"}


def test_meta_platforms_cover_matches_specs():
    client = TestClient(app)
    body = client.get("/api/meta/platforms").json()
    # 与 COVER_SPECS 键一致且有序（sorted）
    assert body["cover"] == sorted(COVER_SPECS)
    assert len(body["cover"]) == 6


def test_meta_platforms_entry_urls_and_voices():
    client = TestClient(app)
    body = client.get("/api/meta/platforms").json()
    assert body["entry_urls"] == PUBLISH_ENTRY_URLS
    # voices 键为展示名，值为 edge-tts 音色值
    assert body["voices"] == VOICES
    assert len(body["voices"]) == 3


def test_meta_stats_aggregates_zone_x_status(client, db_session):
    """多区多状态资产按 zone×status 聚合；0 计数状态省略；recipes 计数独立。"""
    db_session.add_all([
        Asset(zone=AssetZone.SOURCE, status=AssetStatus.AVAILABLE, title="素材一"),
        Asset(zone=AssetZone.SOURCE, status=AssetStatus.AVAILABLE, title="素材二"),
        Asset(zone=AssetZone.TOPIC, status=AssetStatus.CANDIDATE, title="选题一"),
        Asset(zone=AssetZone.TOPIC, status=AssetStatus.RESEARCHING, title="选题二"),
        Asset(zone=AssetZone.MASTER, status=AssetStatus.FINALIZED, title="母版一"),
        Asset(zone=AssetZone.PUBLISH, status=AssetStatus.PUBLISHING, title="发布一"),
        Asset(zone=AssetZone.PUBLISH, status=AssetStatus.PUBLISHED, title="发布二"),
    ])
    db_session.add_all([
        Recipe(kind=RecipeKind.COVER_TEMPLATE, name="封面模板A", content="x"),
        Recipe(kind=RecipeKind.TEXT_PROMPT, name="提示词A", content="x"),
        Recipe(kind=RecipeKind.TEXT_PROMPT, name="提示词B", content="x"),
    ])
    db_session.commit()

    resp = client.get("/api/meta/stats")
    assert resp.status_code == 200
    body = resp.json()

    assert body["total"] == 7
    # 四个区恒在（无资产的区也给 total: 0）；仅出现计数 > 0 的状态
    assert set(body["zones"].keys()) == {"source", "topic", "master", "publish"}
    assert body["zones"]["source"] == {"total": 2, "available": 2}
    assert body["zones"]["topic"] == {"total": 2, "candidate": 1, "researching": 1}
    assert body["zones"]["master"] == {"total": 1, "finalized": 1}
    assert body["zones"]["publish"] == {"total": 2, "publishing": 1, "published": 1}
    assert body["recipes"] == 3


def test_meta_stats_empty_db_keeps_all_zones(client):
    """空库：total=0、四区均 {total: 0} 且无状态键、recipes=0。"""
    body = client.get("/api/meta/stats").json()
    assert body == {
        "total": 0,
        "zones": {z: {"total": 0} for z in ("source", "topic", "master", "publish")},
        "recipes": 0,
    }
