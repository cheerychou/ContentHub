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


def _make_master(client, title="母版"):
    resp = client.post(
        "/api/assets",
        data={"zone": "master", "title": title},
        files={"file": ("a.md", "# h".encode(), "text/markdown")},
    )
    assert resp.status_code == 201
    return resp.json()


def _make_publish(client, master, title="公众号版"):
    resp = client.post(
        f"/api/assets/{master['id']}/derive",
        data={"title": title, "platform": "微信公众号"},
        files={"file": ("p.md", b"x", "text/markdown")},
    )
    assert resp.status_code == 201
    return resp.json()


def test_register_publish_info_on_publish_asset(client):
    master = _make_master(client)
    pub = _make_publish(client, master)
    resp = client.patch(
        f"/api/assets/{pub['id']}/publish-info",
        json={"published_url": "https://mp.weixin.qq.com/s/abc123"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["published_url"] == "https://mp.weixin.qq.com/s/abc123"
    assert body["published_at"] is not None


def test_duplicate_register_conflict(client):
    master = _make_master(client)
    pub = _make_publish(client, master)
    first = client.patch(
        f"/api/assets/{pub['id']}/publish-info",
        json={"published_url": "https://mp.weixin.qq.com/s/abc123"},
    )
    assert first.status_code == 200
    dup = client.patch(
        f"/api/assets/{pub['id']}/publish-info",
        json={"published_url": "https://mp.weixin.qq.com/s/other"},
    )
    assert dup.status_code == 409


def test_clear_then_reregister(client):
    master = _make_master(client)
    pub = _make_publish(client, master)
    client.patch(
        f"/api/assets/{pub['id']}/publish-info",
        json={"published_url": "https://mp.weixin.qq.com/s/abc123"},
    )
    cleared = client.patch(
        f"/api/assets/{pub['id']}/publish-info", json={"clear": True}
    )
    assert cleared.status_code == 200
    body = cleared.json()
    assert body["published_url"] is None
    assert body["published_at"] is None
    again = client.patch(
        f"/api/assets/{pub['id']}/publish-info",
        json={"published_url": "https://mp.weixin.qq.com/s/xyz"},
    )
    assert again.status_code == 200
    assert again.json()["published_url"] == "https://mp.weixin.qq.com/s/xyz"


def test_register_on_master_zone_rejected(client):
    master = _make_master(client)
    resp = client.patch(
        f"/api/assets/{master['id']}/publish-info",
        json={"published_url": "https://example.com/x"},
    )
    assert resp.status_code == 422


def test_invalid_url_rejected(client):
    master = _make_master(client)
    pub = _make_publish(client, master)
    resp = client.patch(
        f"/api/assets/{pub['id']}/publish-info",
        json={"published_url": "not-a-url"},
    )
    assert resp.status_code == 422
