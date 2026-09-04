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


def test_derive_text_end_to_end(client, db_session, monkeypatch):
    master = client.post(
        "/api/assets", data={"zone": "master", "title": "定稿文章"},
        files={"file": ("a.md", "正文内容：168 元保养 299 元漆面。".encode(),
                        "text/markdown")}).json()
    recipe = client.post("/api/recipes", json={
        "kind": "text_prompt", "name": "口播稿-测试",
        "content": "把【母版正文】改写成口播稿。"}).json()

    captured = {}

    class SpyLLM:
        def complete(self, system, user):
            captured.update(system=system, user=user)
            return "# 口播稿\n\n大家好，今天聊跨品牌售后。"

    from app import llm as llm_mod
    monkeypatch.setattr(llm_mod, "get_llm", lambda: SpyLLM())

    resp = client.post(f"/api/assets/{master['id']}/derive-text", json={
        "recipe_id": recipe["id"], "title": "口播稿：跨品牌售后",
        "instructions": "控制在 800 字"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["zone"] == "publish" and body["content_type"] == "markdown"
    assert body["object_key"] is None
    assert body["text_content"].startswith("# 口播稿")
    assert body["meta"]["generated"] is True
    assert body["meta"]["recipe_id"] == recipe["id"]
    assert body["upstream"][0]["source_asset_id"] == master["id"]
    assert body["upstream"][0]["recipe_ref"] == recipe["id"]
    assert "168 元保养" in captured["user"]          # 母版正文已注入
    assert "800 字" in captured["user"]              # instructions 已追加
    assert "把【母版正文】改写成口播稿。" not in captured["system"]  # 占位符已替换
    assert "168 元保养 299 元漆面" in captured["system"]


def test_derive_text_unconfigured_llm(client, db_session, monkeypatch):
    master = client.post(
        "/api/assets", data={"zone": "master", "title": "定稿"},
        files={"file": ("a.md", "正文".encode(), "text/markdown")}).json()
    recipe = client.post("/api/recipes", json={
        "kind": "text_prompt", "name": "P2", "content": "改写【母版正文】"}).json()

    from app import llm as llm_mod

    def _raise():
        raise llm_mod.LLMNotConfigured("no key")

    monkeypatch.setattr(llm_mod, "get_llm", _raise)
    resp = client.post(f"/api/assets/{master['id']}/derive-text", json={
        "recipe_id": recipe["id"], "title": "t"})
    assert resp.status_code == 503


def test_derive_text_params_substitution(client, monkeypatch):
    master = client.post(
        "/api/assets", data={"zone": "master", "title": "定稿"},
        files={"file": ("a.md", "正文：机油保养 168 元。".encode(),
                        "text/markdown")}).json()
    recipe = client.post("/api/recipes", json={
        "kind": "text_prompt", "name": "GEO-测试",
        "content": "用户视角：{perspective}。母版：【母版正文】"}).json()

    captured = {}

    class SpyLLM:
        def complete(self, system, user):
            captured.update(system=system, user=user)
            return "# GEO"

    from app import llm as llm_mod
    monkeypatch.setattr(llm_mod, "get_llm", lambda: SpyLLM())

    resp = client.post(f"/api/assets/{master['id']}/derive-text", json={
        "recipe_id": recipe["id"], "title": "GEO 变体",
        "params": {"perspective": "汽车维修门店老板"}})
    assert resp.status_code == 201
    assert "汽车维修门店老板" in captured["system"]
    assert "{perspective}" not in captured["system"]
