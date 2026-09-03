import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app
from app.storage import FakeStorage, get_storage


@pytest.fixture()
def client(db_session):
    fake = FakeStorage()
    app.dependency_overrides[get_db] = lambda: (yield db_session)
    app.dependency_overrides[get_storage] = lambda: fake
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _make(client, zone="master", title="母版"):
    resp = client.post(
        "/api/assets",
        data={"zone": zone, "title": title},
        files={"file": ("a.md", "# h".encode(), "text/markdown")},
    )
    assert resp.status_code == 201
    return resp.json()


def test_derive_from_master_creates_publish_and_lineage(client):
    master = _make(client)
    resp = client.post(
        f"/api/assets/{master['id']}/derive",
        data={"title": "公众号版", "platform": "微信公众号"},
        files={"file": ("pub.md", "正文".encode(), "text/markdown")},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["zone"] == "publish"
    assert body["status"] == "publishing"
    assert body["meta"] == {"platform": "微信公众号"}
    assert body["upstream"][0]["source_asset_id"] == master["id"]


def test_derive_from_source_rejected(client):
    src = _make(client, zone="source", title="信源")
    resp = client.post(
        f"/api/assets/{src['id']}/derive",
        data={"title": "x", "platform": "抖音"},
        files={"file": ("p.md", b"x", "text/markdown")},
    )
    assert resp.status_code == 422


def test_link_source_to_publish_rejected(client):
    src = _make(client, zone="source", title="信源")
    master = _make(client, title="母版")
    pub = client.post(
        f"/api/assets/{master['id']}/derive",
        data={"title": "公众号版", "platform": "微信公众号"},
        files={"file": ("p.md", b"x", "text/markdown")},
    ).json()
    resp = client.post(
        f"/api/assets/{pub['id']}/derivations",
        json={"source_asset_id": src["id"], "note": "补链"},
    )
    assert resp.status_code == 422


def test_link_duplicate_relation_conflict(client):
    master = _make(client, title="母版")
    pub = client.post(
        f"/api/assets/{master['id']}/derive",
        data={"title": "公众号版", "platform": "微信公众号"},
        files={"file": ("p.md", b"x", "text/markdown")},
    ).json()
    resp = client.post(
        f"/api/assets/{pub['id']}/derivations",
        json={"source_asset_id": master["id"]},
    )
    assert resp.status_code == 409


def test_detail_shows_downstream(client):
    master = _make(client, title="母版")
    client.post(
        f"/api/assets/{master['id']}/derive",
        data={"title": "公众号版", "platform": "微信公众号"},
        files={"file": ("p.md", b"x", "text/markdown")},
    )
    detail = client.get(f"/api/assets/{master['id']}").json()
    assert [d["derived_asset_id"] for d in detail["downstream"]]
