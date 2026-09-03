# M1 配方派生引擎 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建成 ContentHub M1 配方派生引擎——封面排版渲染（四平台规格、模板+无头截图替代 Keynote 手工）、LLM 文本变体（口播稿/GEO 多视角/平台适配）、发布登记，并清偿 M0 终审遗留的工程待办。

**Architecture:** 新增 `recipes` 表（kind: cover_template/text_prompt）；封面渲染 = Jinja2 模板渲染 HTML + Playwright Chromium 截图（同步 API，跑在 FastAPI 线程池）；文本变体 = OpenAI 兼容 chat/completions（测试用 FakeLLM）；发布登记 = assets 新增 published_url/published_at 列 + 状态机收口。渲染产物与文本产物均为 publish 区资产，经现有 Derivation 自动记血缘。

**Tech Stack:** 在 M0 栈上新增 jinja2、playwright（chromium）、httpx（已装）。

## Global Constraints

- 沿用 M0 全部约束：依赖带上限；红线（无 OpenMetadata/Neo4j/Celery/多租户/自动上传/鉴权）；端口 5433/8001/8080/9000；Conventional Commits；TDD。
- **测试库不得为开发/生产库**（M0 终审教训）：conftest 强制 `contenthub_test` 的守卫不得削弱。
- LLM key 只走环境变量（`CH_LLM_API_KEY`），绝不入库、不入测试；测试一律用 FakeLLM，不发起真实网络调用。
- 封面渲染必须离线确定性：截图期间无网络依赖（原图经 storage.get_bytes 落地为 file:// 引用）；同一输入多次渲染结果一致（无随机元素）。
- 四平台封面规格（2026-09 通行值，可在配方 meta 覆盖）：微信公众号 900×383、抖音 1080×1440、微信视频号 1080×1260、哔哩哔哩 1146×717。
- 文本变体产物统一 `content_type=markdown`、`text_content` 存正文、无 object_key；封面产物 `content_type=image`、PNG、有 object_key。
- 派生区规则不变：新产物一律 publish 区、status=publishing、自动写 Derivation（source=母版、recipe_ref=配方 id）。

---

### Task 1: 配方模型 + 发布登记列 + 时区列修正（一个迁移）

**Files:**
- Create: `backend/app/models_recipe.py` 不新建——直接改 `backend/app/models.py`（追加 Recipe，扩展 Asset）
- Modify: `backend/app/models.py`
- Create: `backend/alembic/versions/*_m1_recipes_publish.py`（autogenerate 后编辑）
- Modify: `backend/tests/test_models.py`（追加测试）
- Modify: `backend/tests/conftest.py`（TRUNCATE 增加 recipes）

**Interfaces:**
- Consumes: `app.db.Base`、现有 Asset
- Produces:
  - `app.models.Recipe`（字段：`id: UUID`、`kind: RecipeKind`、`name: str(200)`、`description: str|None`、`content: Text`、`meta: JSONB`(default {})、`created_by: str`、`created_at/updated_at`；name 全局唯一）
  - `app.models.RecipeKind`（`cover_template` / `text_prompt`）
  - `Asset` 新增：`published_url: str|None`、`published_at: datetime|None`；`created_at/updated_at` 改为 `DateTime(timezone=True)`
  - 测试：Recipes CRUD 往返、唯一名约束、新列默认空

- [ ] **Step 1: 写失败测试（追加到 test_models.py）**

```python
from app.models import Recipe, RecipeKind


def test_recipe_roundtrip_and_unique_name(db_session):
    r = Recipe(kind=RecipeKind.COVER_TEMPLATE, name="默认封面模板",
               content="<html>{{ title }}</html>", meta={"platform": "微信公众号"})
    db_session.add(r)
    db_session.flush()
    db_session.expire_all()
    got = db_session.get(Recipe, r.id)
    assert got.kind is RecipeKind.COVER_TEMPLATE
    assert got.meta["platform"] == "微信公众号"

    dup = Recipe(kind=RecipeKind.TEXT_PROMPT, name="默认封面模板", content="x")
    db_session.add(dup)
    import pytest
    from sqlalchemy.exc import IntegrityError
    with pytest.raises(IntegrityError):
        db_session.flush()


def test_publish_info_columns_default_null(db_session):
    a = Asset(zone=AssetZone.MASTER, status=AssetStatus.DRAFTING,
              title="t", content_type="markdown")
    db_session.add(a)
    db_session.flush()
    db_session.expire_all()
    got = db_session.get(Asset, a.id)
    assert got.published_url is None
    assert got.published_at is None
    assert got.created_at.tzinfo is not None  # timestamptz
```

- [ ] **Step 2: 运行确认失败**（`cd backend && .venv/bin/pytest tests/test_models.py -v`，ImportError: Recipe）

- [ ] **Step 3: 改 models.py**

models.py 顶部 import 区补 `from sqlalchemy import DateTime`（并入现有 import 行）；追加：

```python
class RecipeKind(str, enum.Enum):
    COVER_TEMPLATE = "cover_template"
    TEXT_PROMPT = "text_prompt"


class Recipe(Base):
    __tablename__ = "recipes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    kind: Mapped[RecipeKind] = mapped_column(
        SAEnum(RecipeKind, values_callable=lambda e: [m.value for m in e],
               name="recipekind")
    )
    name: Mapped[str] = mapped_column(String(200), unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    created_by: Mapped[str] = mapped_column(String(100), default="zhoudabo")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
```

Asset 类修改（两处）：

```python
    # created_at / updated_at 改为时区感知列：
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    # 发布登记（M1）：发布后回填
    published_url: Mapped[str | None] = mapped_column(String(2000))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
```

- [ ] **Step 4: conftest TRUNCATE 追加 recipes**

`db.execute(text("TRUNCATE assets, derivations, recipes CASCADE"))`（两处出现 TRUNCATE 的行——`db_session` 夹具——都要改；若仅一处则改一处）。

- [ ] **Step 5: 生成迁移**

```bash
cd backend && .venv/bin/alembic revision --autogenerate -m "m1 recipes and publish info"
```

编辑生成的迁移：确认含 (a) 建 recipes 表 + recipekind 枚举，(b) assets 加 published_url/published_at，(c) created_at/updated_at 改 type 为 `sa.DateTime(timezone=True)`（postgresql 下 automigrate 通常生成 `ALTER COLUMN ... TYPE TIMESTAMP WITH TIME ZONE`，保留）；downgrade 补两枚举 drop（`sa.Enum(name="recipekind").drop(op.get_bind(), checkfirst=True)`，仿照 initial 迁移模式）。

验证循环：

```bash
.venv/bin/alembic upgrade head && .venv/bin/alembic downgrade -1 && .venv/bin/alembic upgrade head
.venv/bin/pytest -q
```

预期：迁移循环成功；26+2=28 passed（老测试对 created_at.tzinfo 的断言若无会保持绿；如 initial 迁移与 create_all 有列类型差异导致 trgm 索引测试类问题，仅报告不扩大改动）。

- [ ] **Step 6: 提交**

```bash
git add backend && git commit -m "feat: M1 配方模型与发布登记列（含时区列修正）"
```

---

### Task 2: M0 终审待办清偿（工程小项打包）

**Files:**
- Modify: `backend/app/routers/assets.py`（IntegrityError→409、负 limit 守卫）
- Modify: `backend/app/storage.py`（get_storage 线程锁）
- Modify: `docker-compose.yml`（api healthcheck）
- Modify: `frontend/nginx.conf`（/minio 限定 GET + 桶前缀）
- Modify: `backend/tests/test_derivations_api.py`（derive-from-publish 单测、link 竞态回归）

**Interfaces:**
- Produces: `ObjectStorage` 不变；行为变化：重复 link 并发返回 409 而非 500；`limit<0 or offset<0` → 422；api 容器有 healthcheck；`/minio/` 仅代理 GET 且仅三个桶路径；derive 对 publish 源返回 422 有测试锁定

- [ ] **Step 1: 失败测试先行**

test_derivations_api.py 追加：

```python
def test_derive_from_publish_rejected(client):
    master = _make(client, title="母版")
    pub = client.post(
        f"/api/assets/{master['id']}/derive",
        data={"title": "公众号版", "platform": "微信公众号"},
        files={"file": ("p.md", b"x", "text/markdown")},
    ).json()
    resp = client.post(
        f"/api/assets/{pub['id']}/derive",
        data={"title": "二阶派生", "platform": "抖音"},
        files={"file": ("q.md", b"y", "text/markdown")},
    )
    assert resp.status_code == 422


def test_list_rejects_negative_paging(client):
    resp = client.get("/api/assets", params={"limit": -1})
    assert resp.status_code == 422
```

- [ ] **Step 2: 运行确认失败**（derive-from-publish 现 201；limit=-1 现 500）

- [ ] **Step 3: 实现**

assets.py：
- `list_assets` 签名改 `limit: int = Query(50, ge=0, le=200), offset: int = Query(0, ge=0)`（import Query）
- `link_derivation` 的 `db.commit()` 包 try/except：

```python
    from sqlalchemy.exc import IntegrityError
    d = Derivation(source_asset_id=source.id, derived_asset_id=derived.id,
                   recipe_ref=body.recipe_ref, note=body.note)
    db.add(d)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "派生关系已存在")
    db.refresh(d)
    return d
```

storage.py `get_storage` 加模块级锁：

```python
import threading
_storage_lock = threading.Lock()

def get_storage() -> ObjectStorage:
    global _storage
    if _storage is None:
        with _storage_lock:
            if _storage is None:
                _storage = MinioStorage(
                    settings.minio_endpoint,
                    settings.minio_access_key,
                    settings.minio_secret_key,
                    settings.bucket_prefix,
                )
                _storage.ensure_buckets()
    return _storage
```

docker-compose.yml api 服务追加：

```yaml
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request;urllib.request.urlopen('http://localhost:8000/api/health')\""]
      interval: 10s
      timeout: 5s
      retries: 5
```

（api 依赖 healthcheck：`frontend.depends_on.api.condition: service_healthy`。）

frontend/nginx.conf 的 `/minio/` 收紧为：

```nginx
    location ~ ^/minio/contenthub-(source|master|publish)/ {
        limit_except GET {
            deny all;
        }
        proxy_pass http://minio:9000;
    }
```

注意：`location ~` 正则匹配不剥前缀，`proxy_pass` 不带 URI 时原始路径 `/minio/contenthub-master/...` 原样转发——**MinIO 侧无 /minio 前缀**，因此需 rewrite：在 location 内加 `rewrite ^/minio(/.*)$ $1 break;` 并保持 `proxy_pass http://minio:9000;`（无 URI）。同时 Task 7 的 api.ts 重写逻辑不变（仍把 `http://minio:9000` 替换为 `/minio`）。

- [ ] **Step 4: 全套验证**

```bash
cd backend && .venv/bin/pytest -q                      # 28 passed
cd .. && /Applications/Docker.app/Contents/Resources/bin/docker compose up -d --build api frontend
curl -s "http://localhost:8080/api/assets?limit=-1" -o /dev/null -w '%{http_code}\n'   # 422
```

再取一条真实资产的 file_url 验证收紧后代理仍 200（path 提取后 `curl -s -o /dev/null -w '%{http_code} %{size_download}' "http://localhost:8080/minio/<bucket>/<key>?<query>"` → 200 且字节数>0）。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "fix: M0 终审待办清偿（409/分页守卫/存储锁/healthcheck/minio 收紧）"
```

---

### Task 3: 基础设施层——storage.get_bytes + LLM client + 封面规格

**Files:**
- Modify: `backend/app/storage.py`（ObjectStorage/MinioStorage/FakeStorage 加 `get_bytes(zone, key) -> bytes`）
- Create: `backend/app/llm.py`
- Create: `backend/app/cover_specs.py`
- Modify: `backend/app/config.py`（llm_base_url/llm_api_key/llm_model）
- Modify: `backend/tests/test_storage.py`、Create `backend/tests/test_llm.py`

**Interfaces:**
- Produces:
  - `ObjectStorage.get_bytes(zone: str, key: str) -> bytes`（MinioStorage 用 `client.get_object(...).read()`；FakeStorage 直接返回存储 bytes）
  - `app.llm.LLMClient` Protocol：`complete(system: str, user: str) -> str`；`OpenAICompatLLM(base_url, api_key, model, timeout=120)`（httpx POST `{base_url}/chat/completions`，messages=[{role:system},{role:user}]，取 `choices[0].message.content`）；`FakeLLM(responses: dict[str,str]|None)`（按 system 前缀匹配返回，缺省返回确定性占位文本）；`get_llm()`（无 key 时 raise `LLMNotConfigured`）
  - `app.config.Settings` 新增：`llm_base_url: str = "https://open.bigmodel.cn/api/paas/v4"`、`llm_api_key: str = ""`、`llm_model: str = "glm-4-flash"`
  - `app.cover_specs.COVER_SPECS`（Global Constraints 的四平台 dict）+ `spec_for(platform: str, override: dict|None) -> dict`

- [ ] **Step 1: 失败测试**

test_storage.py 追加：

```python
def test_fake_storage_get_bytes():
    s = FakeStorage()
    s.put("master", "k/x.png", b"img", "image/png")
    assert s.get_bytes("master", "k/x.png") == b"img"
```

test_llm.py：

```python
import pytest

from app.llm import FakeLLM, LLMNotConfigured, get_llm


def test_fake_llm_returns_content():
    llm = FakeLLM()
    out = llm.complete("你是口播稿写手", "主题：跨品牌售后")
    assert isinstance(out, str) and out


def test_get_llm_without_key_raises(monkeypatch):
    monkeypatch.setenv("CH_LLM_API_KEY", "")
    import importlib, app.llm as m
    importlib.reload(m)
    with pytest.raises(LLMNotConfigured):
        m.get_llm()


def test_openai_compat_request_shape(httpx_mock := None):
    # 不引入 pytest-httpx：直接断言 URL 组装与 payload 结构（单测 FakeLLM 覆盖行为，真实 HTTP 由全栈验收覆盖）
    from app.llm import OpenAICompatLLM
    llm = OpenAICompatLLM(base_url="https://example.invalid/v4",
                          api_key="k", model="glm-4-flash")
    assert llm.url == "https://example.invalid/v4/chat/completions"
```

- [ ] **Step 2: 确认失败后实现**

config.py Settings 追加三字段（见 Interfaces）。storage.py：三实现各加 `get_bytes`（MinioStorage：`resp = self.client.get_object(self.buckets[zone], key); try: return resp.read() finally: resp.close(); resp.release_conn()`）。

`backend/app/llm.py`：

```python
"""LLM 文本生成客户端：OpenAI 兼容接口，测试用 FakeLLM。"""
import os
from typing import Protocol

import httpx

from .config import settings


class LLMNotConfigured(RuntimeError):
    pass


class LLMClient(Protocol):
    def complete(self, system: str, user: str) -> str: ...


class OpenAICompatLLM:
    def __init__(self, base_url: str, api_key: str, model: str,
                 timeout: float = 120.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    @property
    def url(self) -> str:
        return f"{self.base_url}/chat/completions"

    def complete(self, system: str, user: str) -> str:
        resp = httpx.post(
            self.url,
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": 0.7,
            },
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


class FakeLLM:
    """确定性假实现：按 system 含子串匹配返回，未命中返回通用占位。"""

    def __init__(self, responses: dict[str, str] | None = None):
        self.responses = responses or {}

    def complete(self, system: str, user: str) -> str:
        for key, text in self.responses.items():
            if key in system:
                return text
        return f"[FakeLLM:{len(user)}字]"


_llm: LLMClient | None = None


def get_llm() -> LLMClient:
    global _llm
    if _llm is None:
        if not settings.llm_api_key:
            raise LLMNotConfigured(
                "未配置 CH_LLM_API_KEY，文本变体不可用（封面渲染不受影响）"
            )
        _llm = OpenAICompatLLM(settings.llm_base_url, settings.llm_api_key,
                               settings.llm_model)
    return _llm
```

`backend/app/cover_specs.py`：

```python
"""四平台封面规格（2026-09 通行值；配方 meta.spec 可覆盖）。"""
COVER_SPECS: dict[str, dict[str, int]] = {
    "微信公众号": {"width": 900, "height": 383},
    "抖音": {"width": 1080, "height": 1440},
    "微信视频号": {"width": 1080, "height": 1260},
    "哔哩哔哩": {"width": 1146, "height": 717},
}


def spec_for(platform: str, override: dict | None = None) -> dict[str, int]:
    base = dict(COVER_SPECS[platform])  # 未知平台 KeyError → 调用方转 422
    if override:
        base.update({k: int(v) for k, v in override.items() if k in ("width", "height")})
    return base
```

test_llm.py 的 `test_get_llm_without_key_raises` 使用 monkeypatch + reload——若模块级 `get_llm` 已有单例缓存需先 `_llm = None`（reload 即重置）。注意该测试不持久影响其他用例（其他用例不依赖真实 key）。

- [ ] **Step 3: 全套通过**（`cd backend && .venv/bin/pytest -q`，预期 28+3=31 passed）

- [ ] **Step 4: 提交** `git commit -m "feat: M1 基础设施（storage.get_bytes / OpenAI 兼容 LLM client / 封面规格）"`

---

### Task 4: 配方 API + 默认配方种子

**Files:**
- Create: `backend/app/routers/recipes.py`
- Modify: `backend/app/main.py`（挂载）
- Create: `backend/app/seed_recipes.py`
- Modify: `backend/app/schemas.py`（RecipeOut/RecipeCreate/RecipeUpdate）
- Create: `backend/tests/test_recipes_api.py`
- Modify: `backend/Dockerfile`（CMD 迁移后追加 `python -m app.seed_recipes`）

**Interfaces:**
- Produces:
  - `POST /api/recipes` `{kind, name, description?, content, meta?}` → 201 RecipeOut；重名 409
  - `GET /api/recipes?kind=` → list；`GET/PUT/DELETE /api/recipes/{id}`（PUT 改 name 冲突 409）
  - Schemas：`RecipeOut(id, kind, name, description, content, meta, created_by, created_at, updated_at)`、`RecipeCreate`、`RecipeUpdate`（全可选）
  - 种子（幂等，按 name 查在则跳）：`默认封面模板`（cover_template，content 为内置 HTML/Jinja2，meta 含说明）、`口播稿提示词`、`GEO 多视角提示词`、`公众号改编提示词`（text_prompt；content 为可运行的结构化提示词，内嵌 `{{ 母版正文 }}` 占位约定说明）
  - Dockerfile CMD：`alembic upgrade head && python -m app.seed_recipes && uvicorn ...`

- [ ] **Step 1: 失败测试**

```python
def test_recipe_crud_flow(client, db_session):
    create = client.post("/api/recipes", json={
        "kind": "text_prompt", "name": "测试提示词", "content": "把正文改写成口播稿：{{ 母版正文 }}"})
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
```

- [ ] **Step 2: 确认失败后实现**

routers/recipes.py 仿 assets.py 风格（prefix=/api/recipes、get_recipe_or_404、IntegrityError→409）；seed_recipes.py 提供 `seed(db) -> int`（返回新增数）+ `__main__` 入口（SessionLocal）。默认封面模板 content（Jinja2 语法，变量：width/height/title/subtitle/image_file/title_size/subtitle_size/padding）：

```html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin:0; width:{{ width }}px; height:{{ height }}px; overflow:hidden;
         font-family:'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif; }
  .bg { position:absolute; inset:0;
        background-image:url('file://{{ image_file }}');
        background-size:cover; background-position:center; }
  .scrim { position:absolute; inset:0;
           background:linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,.78) 100%); }
  .text { position:absolute; left:0; right:0; bottom:0; padding:{{ padding }}px; color:#fff; }
  .title { font-size:{{ title_size }}px; font-weight:700; line-height:1.3;
           text-shadow:0 2px 8px rgba(0,0,0,.6); }
  .subtitle { font-size:{{ subtitle_size }}px; opacity:.88; margin-top:{{ (subtitle_size // 2) }}px; }
</style></head><body>
  <div class="bg"></div><div class="scrim"></div>
  <div class="text"><div class="title">{{ title }}</div>
  {%- if subtitle %}<div class="subtitle">{{ subtitle }}</div>{% endif %}</div>
</body></html>
```

三个文本提示词的 content 为真实可用提示词（口播稿：口语化、短句、开场钩子、CTA；GEO 多视角：输入 perspective 参数产出特定视角变体；公众号改编：适配公众号排版节奏）。字数各 150-300 字，占位约定统一用 `【母版正文】`（实现中以 `content.replace("【母版正文】", master_text)` 注入——约定写入 description）。

- [ ] **Step 3: 全套通过**（31+2=33 passed）；`docker compose build api` 成功（Dockerfile 含 seed）
- [ ] **Step 4: 提交** `git commit -m "feat: M1 配方 API 与默认配方种子（封面模板/口播稿/GEO/公众号改编）"`

---

### Task 5: 封面渲染引擎 + render-cover 端点

**Files:**
- Create: `backend/app/rendering.py`
- Modify: `backend/app/routers/assets.py`（POST /api/assets/{id}/render-cover）
- Modify: `backend/pyproject.toml`（jinja2>=3.1,<4.0；playwright>=1.45,<2.0 dev 可选——运行依赖直接加 dependencies）
- Modify: `backend/Dockerfile`（`RUN pip install playwright && playwright install --with-deps chromium`）
- Modify: `backend/tests/test_render_cover_api.py`（新建）

**Interfaces:**
- Produces:
  - `app.rendering.render_cover(recipe_content: str, spec: dict, image_bytes: bytes, title: str, subtitle: str|None) -> bytes`（PNG）：写临时 html（jinja2 渲染，image_file=临时 png 的绝对路径），playwright chromium 以 spec 宽高 viewport + device_scale_factor=2 截图
  - `POST /api/assets/{master_id}/render-cover`：multipart `recipe_id`、`platform`、`title`、`subtitle?`、可选 `spec`（JSON 字符串覆盖宽高）→ 201 AssetDetail；母版无图片文件 422；未知平台 422；配方缺失 404；产物：publish 区 PNG 资产（title=`{platform}封面：{title}`，meta={"platform", "rendered": true, "recipe_id"}）+ Derivation
  - 测试策略：单测 monkeypatch `rendering.screenshot` 为确定性伪实现（返回固定 bytes），验证端到端管线（模板渲染上下文、规格、存储、血缘）；真实截图由全栈验收覆盖

- [ ] **Step 1: 依赖与 Dockerfile**

pyproject dependencies 追加 `"jinja2>=3.1,<4.0"`、`"playwright>=1.45,<2.0"`；本地 `pip install -e ".[dev]" && .venv/bin/playwright install chromium`（约 150MB，一次性）。Dockerfile 在 `RUN pip install --no-cache-dir .` 后追加：

```dockerfile
RUN pip install --no-cache-dir playwright && playwright install --with-deps chromium
```

- [ ] **Step 2: 失败测试**

```python
import json

import pytest


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
```

- [ ] **Step 3: 确认失败后实现**

`backend/app/rendering.py`：

```python
"""封面排版渲染：Jinja2 模板 → Playwright Chromium 截图（离线确定性）。"""
import tempfile
from pathlib import Path

from jinja2 import Template


def render_html(recipe_content: str, context: dict) -> str:
    return Template(recipe_content).render(**context)


def screenshot(html_text: str, width: int, height: int) -> bytes:
    from playwright.sync_api import sync_playwright

    with tempfile.TemporaryDirectory() as tmp:
        html_path = Path(tmp) / "cover.html"
        html_path.write_text(html_text, encoding="utf-8")
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                page = browser.new_page(
                    viewport={"width": width, "height": height},
                    device_scale_factor=2,
                )
                page.goto(html_path.as_uri())
                page.wait_for_timeout(200)  # 字体/图片就绪
                return page.screenshot(type="png")
            finally:
                browser.close()
```

（image_file 上下文由端点预先把 image_bytes 落为临时 png 并传绝对路径；screenshot 只管 html→png，便于测试替身。）

routers/assets.py 追加端点：

```python
@router.post("/{master_id}/render-cover", status_code=201, response_model=AssetDetail)
def render_cover_for_master(
    master_id: uuid.UUID,
    recipe_id: uuid.UUID = Form(...),
    platform: str = Form(...),
    title: str = Form(...),
    subtitle: str | None = Form(None),
    spec: str | None = Form(None),   # JSON: {"width":..,"height":..} 可覆盖
    db: Session = Depends(get_db),
    storage=Depends(get_storage),
):
    master = get_asset_or_404(db, master_id)
    if not master.object_key or master.content_type != "image":
        raise HTTPException(422, "封面渲染的母版必须是已上传图片资产")
    recipe = db.get(Recipe, recipe_id)
    if recipe is None or recipe.kind != RecipeKind.COVER_TEMPLATE:
        raise HTTPException(404, "封面模板配方不存在")
    if platform not in COVER_SPECS:
        raise HTTPException(422, f"未知平台 {platform}；可选 {sorted(COVER_SPECS)}")

    spec_dict = spec_for(platform, json.loads(spec) if spec else None)
    image_bytes = storage.get_bytes(master.zone.value, master.object_key)

    with tempfile.TemporaryDirectory() as tmp:
        img_path = Path(tmp) / "bg" + Path(master.file_name or "bg.png").suffix
        img_path.write_bytes(image_bytes)
        html = render_html(recipe.content, {
            "width": spec_dict["width"], "height": spec_dict["height"],
            "title": title, "subtitle": subtitle,
            "image_file": str(img_path),
            "title_size": max(28, spec_dict["height"] // 12),
            "subtitle_size": max(18, spec_dict["height"] // 20),
            "padding": max(24, spec_dict["width"] // 18),
        })
        png = screenshot(html, spec_dict["width"], spec_dict["height"])

    pub = Asset(zone=AssetZone.PUBLISH, status=AssetStatus.PUBLISHING,
                title=f"{platform}封面：{title}",
                file_name=f"cover-{platform}.png", content_type="image",
                created_by=master.created_by,
                meta={"platform": platform, "rendered": True,
                      "recipe_id": str(recipe_id), "spec": spec_dict})
    db.add(pub)
    db.flush()
    key = f"{pub.id}/cover-{platform}.png"
    storage.put(AssetZone.PUBLISH, key, png, "image/png")
    pub.object_key = key
    db.add(Derivation(source_asset_id=master.id, derived_asset_id=pub.id,
                      recipe_ref=str(recipe_id), created_by=master.created_by))
    db.commit()
    db.refresh(pub)
    detail = AssetDetail.model_validate(pub)
    detail.upstream = [DerivationOut.model_validate(d) for d in pub.upstream]
    detail.file_url = storage.presigned_get(pub.zone.value, pub.object_key)
    return detail
```

import 区补：`import json`、`from pathlib import Path`、`import tempfile`、`from ..cover_specs import COVER_SPECS, spec_for`、`from ..models import Recipe, RecipeKind`（并入现有 models import）、`from ..rendering import render_html, screenshot`。

注意 `img_path = Path(tmp) / "bg" + suffix` 是错误写法——实现时用 `Path(tmp) / f"bg{Path(master.file_name or 'bg.png').suffix or '.png'}"`。

- [ ] **Step 4: 测试通过**（33+3=36 passed）；`docker compose build api` 确认 chromium 安装层成功
- [ ] **Step 5: 提交** `git commit -m "feat: M1 封面排版渲染引擎（Jinja2+Playwright，四平台规格）"`

---

### Task 6: 文本变体 derive-text 端点

**Files:**
- Modify: `backend/app/routers/assets.py`（POST /api/assets/{id}/derive-text）
- Modify: `backend/app/schemas.py`（DeriveTextCreate）
- Create: `backend/tests/test_derive_text_api.py`

**Interfaces:**
- Produces:
  - `POST /api/assets/{master_id}/derive-text`：JSON `{recipe_id, title, instructions?}` → 201 AssetDetail；LLM 未配置 503；母版无 text_content 422；产物：publish 区 markdown 资产（text_content=生成正文，无 object_key，meta={"platform": recipe 派生用途, "generated": true}）+ Derivation
  - 正文注入约定：`recipe.content.replace("【母版正文】", master.text_content)`；`instructions` 追加到 user 消息尾部
  - 测试用 `app.llm.FakeLLM` monkeypatch `get_llm`

- [ ] **Step 1: 失败测试**

```python
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
    assert body["upstream"][0]["source_asset_id"] == master["id"]
    assert "168 元保养" in captured["user"]          # 母版正文已注入
    assert "800 字" in captured["user"]              # instructions 已追加


def test_derive_text_unconfigured_llm(client, db_session, monkeypatch):
    master = client.post(
        "/api/assets", data={"zone": "master", "title": "定稿"},
        files={"file": ("a.md", "正文".encode(), "text/markdown")}).json()
    recipe = client.post("/api/recipes", json={
        "kind": "text_prompt", "name": "P2", "content": "改写【母版正文】"}).json()

    import pytest
    from app import llm as llm_mod

    def _raise():
        raise llm_mod.LLMNotConfigured("no key")

    monkeypatch.setattr(llm_mod, "get_llm", _raise)
    resp = client.post(f"/api/assets/{master['id']}/derive-text", json={
        "recipe_id": recipe["id"], "title": "t"})
    assert resp.status_code == 503
```

- [ ] **Step 2: 确认失败后实现**（assets.py 追加；JSON body 用 DeriveTextCreate：`recipe_id: uuid.UUID, title: str, instructions: str|None = None`）

要点：`llm = get_llm()` 包 try/except LLMNotConfigured → 503；system = 配方 content 注入母版正文后的完整提示词；user = instructions 或 "请开始"。产物 Derivation.recipe_ref = str(recipe_id)。

- [ ] **Step 3: 全套通过**（36+2=38 passed）
- [ ] **Step 4: 提交** `git commit -m "feat: M1 文本变体端点（配方驱动 LLM 派生，未配 key 时 503）"`

---

### Task 7: 发布登记端点

**Files:**
- Modify: `backend/app/routers/assets.py`（PATCH /api/assets/{id}/publish-info）
- Modify: `backend/app/schemas.py`（PublishInfoUpdate：`published_url: HttpUrl|None = None, clear: bool = False`）
- Create: `backend/tests/test_publish_info_api.py`

**Interfaces:**
- Produces:
  - `PATCH /api/assets/{id}/publish-info`：登记 `published_url`（自动回填 `published_at=utcnow()`）→ AssetOut；重复登记（已有 URL 且非 clear）409；`{"clear": true}` 清空两字段（配合状态机回退 publishing）；仅 publish 区资产可登记
  - 各平台上传页跳转 URL 常量（前端用）：`app.cover_specs.PUBLISH_ENTRY_URLS = {"微信公众号": "https://mp.weixin.qq.com/", "抖音": "https://creator.douyin.com/", "微信视频号": "https://channels.weixin.qq.com/platform/post-publish", "哔哩哔哩": "https://member.bilibili.com/platform/upload/video/frame"}`

- [ ] **Step 1: 失败测试**（对 derive 产物：无 URL 时登记 201 语义成功并回填 published_at；再登记 409；clear 后可重登记；对 master 区 422）

- [ ] **Step 2: 确认失败后实现**（端点直改两字段；`published_at = utcnow()`）

- [ ] **Step 3: 全套通过**（38+2=40 passed）
- [ ] **Step 4: 提交** `git commit -m "feat: M1 发布登记端点（URL 回填 + 防重复 + 可清空重登）"`

---

### Task 8: 前端扩展（渲染/变体/登记/配方管理）

**Files:**
- Modify: `frontend/src/types.ts`（Recipe 类型、PUBLISH_ENTRY_URLS）
- Modify: `frontend/src/api.ts`（listRecipes/createRecipe/renderCover/deriveText/publishInfo）
- Modify: `frontend/src/App.tsx`（详情面板三个表单 + 顶部配方管理入口）
- Create: `frontend/src/Recipes.tsx`（配方列表/新建/编辑最简页；路由用简单的 hash 切换，不引 router）
- 验证：`npm run build` + 全栈冒烟

**Interfaces:**
- Consumes: Task 4-7 全部端点
- Produces:
  - 详情面板（publish 区母版为 image 时）：渲染封面表单（平台下拉四平台 + 模板下拉 + 标题/副标题 + 规格覆盖 JSON 可选）→ 成功后刷新详情（新派生出现在下游）
  - 详情面板（master 且有正文）：文本变体表单（text_prompt 配方下拉 + 标题 + 附加指令）→ 503 时提示"未配置 CH_LLM_API_KEY"
  - 详情面板（publish 区）：发布登记行（平台预填 + URL 输入 + "打开平台上传页"外链按 meta.platform 映射 PUBLISH_ENTRY_URLS）
  - `#/recipes` 页：列表（kind 筛选）+ 新建表单（kind/name/content/description）+ 删除；App 顶部加 `#/` 与 `#/recipes` 两个链接（`window.location.hash` 监听切换页面组件）

- [ ] **Step 1: types.ts / api.ts 扩展**（代码按上述接口补齐，风格与现有一致）
- [ ] **Step 2: App.tsx / Recipes.tsx**（hash 路由：`const [route, setRoute] = useState(location.hash); useEffect(() => { const f = () => setRoute(location.hash); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, [])`；`route.startsWith("#/recipes") ? <Recipes/> : <Assets/>`——Assets 即现 App 主体抽出的组件）
- [ ] **Step 3: `npm run build` 通过**
- [ ] **Step 4: 全栈冒烟**（`docker compose up -d --build api frontend`；curl 走 :8080：seed 后 GET /api/recipes 应含 4 条默认配方）
- [ ] **Step 5: 提交** `git commit -m "feat: M1 前端（封面渲染/文本变体/发布登记/配方管理）"`

---

### Task 9: M1 全栈验收 + 文档同步

**Files:**
- Modify: `docs/product/PRD-MVP-001-mvp-build-plan.md`（M1 行验收标记）
- Modify: `README.md`（快速开始补 LLM 配置说明）

**验收脚本（全真实链路，经 :8080）：**

1. **封面渲染验收**（PRD 核心痛点）：`make import` 过的真实母版中挑一篇定稿文章，用一张真实图片资产为底：`POST /render-cover` 四平台各一次（公众号/抖音/视频号/B站）→ 4×201；逐个取 file_url 下载 PNG，`file` 命令确认 PNG 且尺寸与规格一致（`sips -g pixelWidth -g pixelHeight` macOS 原生）。
2. **文本变体验收**：若用户已配置 `CH_LLM_API_KEY`（写入 backend/.env，不入库）：对同一母版跑口播稿配方 → 201 且正文非占位（长度>200、含口播稿特征词）；跑 GEO 配书两个视角变体 → 3×201。未配 key：验证 503 与提示文案后，改用 FakeLLM 的 api 容器（compose override `CH_LLM_API_KEY=fake + CH_LLM_BASE_URL 指向本地 stub`）完成链路验收并在报告中注明"真实 LLM 待用户配 key"。
3. **发布登记验收**：对任一产物登记 `https://mp.weixin.qq.com/s/fake` → published_at 非空；重复 → 409。
4. PRD M1 行追加：`→ ✅ 已完成 | commit: <实现头hash> · <日期>（四平台封面渲染尺寸实测一致、文本变体 N 篇、发布登记闭环）`；README 补 `.env` 配置段。

- [ ] 提交 `git commit -m "docs: M1 验收通过并绑定证据 (PRD-MVP-001)"`

---

### Task 10: 终审 + 合入 main

- 生成全分支 review-package，派终审（含 ledger triage：本计划新增 Minor 一并裁决）
- 终审 Critical/Important 修复后：全测试、合入 main、删分支、更新持久记忆（M1 完成态 + 环境变更）

## Self-Review 记录

- **Spec 覆盖**：PRD §5 M1 三项——封面渲染（T5/T8/T9①）、文本变体（T6/T8/T9②）、发布登记（T7/T8/T9③）；配方库（T4）；终审待办（T2 清偿 + T1 时区列 + T3 storage.get_bytes）。✔
- **占位符扫描**：三段提示词 content 在 T4 标明"150-300 字真实可用文案"属内容创作而非 TBD，执行者按规格撰写。✔
- **类型一致性**：RecipeKind/Recipe 字段、render-cover/derive-text/publish-info 三端点签名与 T8 前端调用一一对应；spec_for 覆盖键仅 width/height。✔
- **风险标注**：Playwright chromium 体积（约 150MB 下载）与首启字体渲染基线为已知成本；`text-wrap:balance` 在 Chromium ≥114 支持（满足）；LLM 真实调用不做自动化测试（仅 Fake + 全栈人工验收），key 永不入库。
