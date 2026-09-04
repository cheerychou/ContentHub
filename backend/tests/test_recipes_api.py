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


def test_recipe_crud_flow(client, db_session):
    create = client.post("/api/recipes", json={
        "kind": "text_prompt", "name": "测试提示词",
        "content": "把正文改写成口播稿：{{ 母版正文 }}"})
    assert create.status_code == 201
    rid = create.json()["id"]

    dup = client.post("/api/recipes", json={
        "kind": "text_prompt", "name": "测试提示词", "content": "x"})
    assert dup.status_code == 409

    lst = client.get("/api/recipes", params={"kind": "text_prompt"}).json()
    assert any(r["id"] == rid for r in lst)

    upd = client.put(f"/api/recipes/{rid}", json={"description": "改写"})
    assert upd.status_code == 200 and upd.json()["description"] == "改写"

    assert client.delete(f"/api/recipes/{rid}").status_code == 204
    assert client.get(f"/api/recipes/{rid}").status_code == 404


def test_seed_recipes_idempotent(db_session):
    from app.seed_recipes import seed
    assert seed(db_session) >= 4
    assert seed(db_session) == 0
