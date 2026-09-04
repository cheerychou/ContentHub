"""meta 端点：平台常量单一来源（cover 规格键 / 发布页跳转 URL / 音色表）。"""
from fastapi.testclient import TestClient

from app.cover_specs import COVER_SPECS, PUBLISH_ENTRY_URLS
from app.main import app
from app.speech import VOICES


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
