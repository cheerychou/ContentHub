"""M4 Task 2：阶段 API —— 按区状态机校验 + 立项初始文稿端点（PRD-MVP-001 v2.4）。"""
import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app
from app.storage import FakeStorage, get_storage


@pytest.fixture()
def fake():
    return FakeStorage()


@pytest.fixture()
def client(db_session, fake):
    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_storage] = lambda: fake
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _make(client, zone, title, name="a.md", text="# 内容"):
    resp = client.post(
        "/api/assets",
        data={"zone": zone, "title": title},
        files={"file": (name, text.encode("utf-8"), "text/markdown")},
    )
    assert resp.status_code == 201
    return resp.json()


def _to_status(client, asset_id, status):
    return client.patch(f"/api/assets/{asset_id}/status", json={"status": status})


def _approve(client, topic_id):
    """candidate → researching → approved。"""
    assert _to_status(client, topic_id, "researching").status_code == 200
    assert _to_status(client, topic_id, "approved").status_code == 200


# ---------- 按区状态机校验（update_status 走 ZONE_TRANSITIONS[asset.zone]）----------


def test_topic_candidate_to_researching_ok(client):
    """选题区：候选 → 调研中 合法。"""
    topic = _make(client, "topic", "选题：途虎供应链")
    resp = _to_status(client, topic["id"], "researching")
    assert resp.status_code == 200
    assert resp.json()["status"] == "researching"


def test_topic_candidate_to_approved_rejected(client):
    """选题区：候选不可直接立项（必须先调研中），且状态不被改动。"""
    topic = _make(client, "topic", "选题：蓝鲸")
    resp = _to_status(client, topic["id"], "approved")
    assert resp.status_code == 422
    assert "非法状态转换" in resp.json()["detail"]
    assert client.get(f"/api/assets/{topic['id']}").json()["status"] == "candidate"


def test_source_available_cannot_transition(client):
    """源料区无状态流转：available 资产任何 PATCH status 均 422。"""
    src = _make(client, "source", "信源")
    assert _to_status(client, src["id"], "available").status_code == 422
    assert _to_status(client, src["id"], "drafting").status_code == 422


# ---------- 立项初始文稿端点 POST /api/assets/{topic_id}/initial-draft ----------


def test_initial_draft_from_approved_topic(client):
    """已立项选题 → initial-draft：source 区 + available + topic→source 血缘。"""
    topic = _make(client, "topic", "选题：途虎供应链")
    _approve(client, topic["id"])
    resp = client.post(
        f"/api/assets/{topic['id']}/initial-draft",
        data={"title": "途虎供应链初始文稿"},
        files={"file": ("draft.md", "初稿正文。".encode("utf-8"), "text/markdown")},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["zone"] == "source"
    assert body["status"] == "available"
    assert body["content_type"] == "markdown"
    assert body["text_content"] == "初稿正文。"
    assert body["object_key"] == f"{body['id']}/draft.md"
    assert len(body["upstream"]) == 1
    assert body["upstream"][0]["source_asset_id"] == topic["id"]
    assert body["upstream"][0]["derived_asset_id"] == body["id"]
    assert body["upstream"][0]["note"] == "立项初始文稿"


def test_initial_draft_requires_approved_status(client):
    """非 approved（候选中）选题 → 422，不产生任何资产。"""
    topic = _make(client, "topic", "选题：候选中")
    resp = client.post(
        f"/api/assets/{topic['id']}/initial-draft",
        data={"title": "过早的文稿"},
        files={"file": ("d.md", b"x", "text/markdown")},
    )
    assert resp.status_code == 422
    assert "仅已立项选题可产出初始文稿" in resp.json()["detail"]
    assert client.get(f"/api/assets/{topic['id']}").json()["downstream"] == []


def test_initial_draft_rejects_non_topic_zone(client):
    """守卫 zone=topic：source 资产不能走 initial-draft。"""
    src = _make(client, "source", "信源")
    resp = client.post(
        f"/api/assets/{src['id']}/initial-draft",
        data={"title": "x"},
        files={"file": ("d.md", b"x", "text/markdown")},
    )
    assert resp.status_code == 422
    assert "仅选题" in resp.json()["detail"]


# ---------- 派生规则回归 ----------


def test_link_source_to_master_still_allowed(client):
    """回归：source→master link 在新增 topic→source 规则后仍合法。"""
    src = _make(client, "source", "信源")
    master = _make(client, "master", "母版")
    resp = client.post(
        f"/api/assets/{master['id']}/derivations",
        json={"source_asset_id": src["id"], "note": "回归"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["source_asset_id"] == src["id"]
    assert body["derived_asset_id"] == master["id"]


def test_link_topic_to_source_allowed(client):
    """新增派生规则：topic → source（如 initial-draft 之外的人工补链）。"""
    topic = _make(client, "topic", "选题：蓝鲸")
    src = _make(client, "source", "背景资料")
    resp = client.post(
        f"/api/assets/{src['id']}/derivations",
        json={"source_asset_id": topic["id"], "note": "选题产出"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["source_asset_id"] == topic["id"]
    assert body["derived_asset_id"] == src["id"]
