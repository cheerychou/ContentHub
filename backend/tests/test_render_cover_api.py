import json

import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app


@pytest.fixture()
def client(db_session):
    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def cover_setup(client, db_session):
    # 母版：上传一张假 PNG
    master = client.post(
        "/api/assets", data={"zone": "master", "title": "封面原图母版"},
        files={"file": ("cover.png", b"\x89PNG fake-bytes", "image/png")},
    ).json()
    recipe = client.post("/api/recipes", json={
        "kind": "cover_template", "name": "测试封面模板",
        "content": "<html>{{ title }}|{{ width }}x{{ height }}</html>"}).json()
    return master, recipe


def test_render_cover_end_to_end(client, cover_setup, monkeypatch):
    master, recipe = cover_setup
    captured = {}

    def fake_screenshot(html_text: str, width: int, height: int) -> bytes:
        captured.update(html=html_text, w=width, h=height)
        return b"\x89PNG rendered"

    from app import rendering
    monkeypatch.setattr(rendering, "screenshot", fake_screenshot)

    resp = client.post(
        f"/api/assets/{master['id']}/render-cover",
        data={"recipe_id": recipe["id"], "platform": "抖音",
              "title": "跨品牌售后", "subtitle": "浪潮之下"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["zone"] == "publish"
    assert body["content_type"] == "image"
    assert body["meta"]["platform"] == "抖音"
    assert body["meta"]["rendered"] is True
    assert body["upstream"][0]["source_asset_id"] == master["id"]
    assert captured["w"] == 1080 and captured["h"] == 1440   # 抖音规格
    assert "跨品牌售后" in captured["html"] and "1080x1440" in captured["html"]


def test_render_cover_requires_image_master(client, cover_setup):
    _, recipe = cover_setup
    text_master = client.post(
        "/api/assets", data={"zone": "master", "title": "纯文本母版"},
        files={"file": ("a.md", b"# x", "text/markdown")}).json()
    resp = client.post(
        f"/api/assets/{text_master['id']}/render-cover",
        data={"recipe_id": recipe["id"], "platform": "抖音", "title": "t"})
    assert resp.status_code == 422


def test_render_cover_unknown_platform(client, cover_setup):
    master, recipe = cover_setup
    resp = client.post(
        f"/api/assets/{master['id']}/render-cover",
        data={"recipe_id": recipe["id"], "platform": "小红书", "title": "t"})
    assert resp.status_code == 422
