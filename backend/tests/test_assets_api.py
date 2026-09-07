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


def _md_file(name="文章.md", text="# 标题\n\n168 元保养 299 元漆面。"):
    return {"file": (name, text.encode("utf-8"), "text/markdown")}


def test_upload_master_defaults_to_drafting(client):
    resp = client.post(
        "/api/assets",
        data={"zone": "master", "title": "跨品牌售后"},
        files=_md_file(),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["zone"] == "master"
    assert body["status"] == "drafting"
    assert body["content_type"] == "markdown"


def test_upload_publish_zone_rejected(client):
    resp = client.post(
        "/api/assets",
        data={"zone": "publish", "title": "公众号版"},
        files=_md_file(),
    )
    assert resp.status_code == 422


def test_upload_source_defaults_to_available(client):
    resp = client.post(
        "/api/assets",
        data={"zone": "source", "title": "信源"},
        files=_md_file(),
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "available"


def test_upload_topic_defaults_to_candidate(client):
    """选题策划页直传：zone=topic 默认候选（评审修复回归）。"""
    resp = client.post(
        "/api/assets",
        data={"zone": "topic", "title": "选题：途虎供应链"},
        files=_md_file(),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["zone"] == "topic"
    assert body["status"] == "candidate"


def test_get_topic_asset_detail_includes_file_url(client):
    """topic 资产详情可取预签名 URL（storage.ZONES 缺 topic 曾致 500，评审修复回归）。"""
    create = client.post(
        "/api/assets",
        data={"zone": "topic", "title": "选题：蓝鲸"},
        files=_md_file("t.md"),
    )
    asset_id = create.json()["id"]
    resp = client.get(f"/api/assets/{asset_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["zone"] == "topic"
    assert body["file_url"] == f"fake://topic/{asset_id}/t.md"


def test_external_link_source(client):
    resp = client.post(
        "/api/assets/external",
        json={
            "zone": "source",
            "title": "九部委 17 条政策原文",
            "source_url": "https://example.com/policy",
        },
    )
    assert resp.status_code == 201
    assert resp.json()["content_type"] == "link"


def test_search_by_body_text(client):
    client.post("/api/assets", data={"zone": "master", "title": "甲文"},
                files=_md_file("a.md", "正文含 关键词蓝鲸。"))
    client.post("/api/assets", data={"zone": "master", "title": "乙文"},
                files=_md_file("b.md", "正文无关。"))
    resp = client.get("/api/assets", params={"q": "蓝鲸"})
    assert resp.status_code == 200
    titles = [a["title"] for a in resp.json()]
    assert titles == ["甲文"]


def test_status_transition_valid_and_invalid(client):
    create = client.post("/api/assets", data={"zone": "master", "title": "t"},
                         files=_md_file())
    asset_id = create.json()["id"]

    bad = client.patch(f"/api/assets/{asset_id}/status", json={"status": "published"})
    assert bad.status_code == 422

    ok = client.patch(f"/api/assets/{asset_id}/status", json={"status": "finalized"})
    assert ok.status_code == 200
    assert ok.json()["status"] == "finalized"


def test_delete_asset(client):
    create = client.post("/api/assets", data={"zone": "master", "title": "t"},
                         files=_md_file())
    asset_id = create.json()["id"]
    assert client.delete(f"/api/assets/{asset_id}").status_code == 204
    assert client.get(f"/api/assets/{asset_id}").status_code == 404


def test_upload_docx_extracts_text(client):
    from io import BytesIO
    from docx import Document
    buf = BytesIO()
    doc = Document()
    doc.add_paragraph("第一段：途虎学什么。")
    doc.add_paragraph("第二段：供应链视角。")
    doc.save(buf)
    resp = client.post(
        "/api/assets", data={"zone": "master", "title": "Word 稿"},
        files={"file": ("途虎.docx", buf.getvalue(),
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["content_type"] == "docx"
    assert "第二段：供应链视角。" in body["text_content"]


def test_upload_broken_docx_422_and_no_object(client, fake):
    """损坏 docx → 422，且先抽取后落盘：存储中不残留孤儿对象。"""
    resp = client.post(
        "/api/assets", data={"zone": "master", "title": "坏 Word"},
        files={"file": ("x.docx", b"not a docx",
                        "application/vnd.openxmlformats-officedocument"
                        ".wordprocessingml.document")},
    )
    assert resp.status_code == 422
    assert "docx 解析失败" in resp.json()["detail"]
    assert fake.objects == {}
