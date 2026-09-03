# M0 资产底座 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建成 ContentHub M0 资产底座——三区存储（source/master/publish）+ 五态状态机 + 全文检索 + Obsidian 批量导入 + 派生（血缘）关系，以 docker-compose 自托管交付，验收标准见 PRD-MVP-001 v2.0 §2。

**Architecture:** FastAPI 单体（API 优先），PostgreSQL 存元数据与全文检索（pg_trgm），MinIO 按区建桶存对象文件，React+Vite 极简前端经 nginx 反代。血缘用两张表（assets/derivations）的关系表达，派生物创建时自动记录。无鉴权、无多租户、无后台队列（M0 红线）。

**Tech Stack:** Python ≥3.12 / FastAPI / SQLAlchemy 2.0 + Alembic / psycopg3 / minio SDK / pytest + httpx / React 18 + TypeScript + Vite / Docker Compose（postgres:16, minio, api, frontend）

## Global Constraints

- 三区 `zone` 取值固定：`source`（源料区）/ `master`（母版区）/ `publish`（发布态）——PRD-MVP-001 v2.0 §3.1。
- 状态机五态固定：`topic → drafting → finalized → publishing → published`；允许返工回退 `finalized → drafting`、`publishing → finalized`；`published` 终态。
- 派生区规则：`publish` 资产只能派生自 `master`（`source → publish` 禁止）；`source → master`、`master → master`、`master → publish` 允许。
- 直接上传禁止 `publish` 区（发布态必须经 `POST /api/assets/{master_id}/derive` 创建）。
- 协作原语仅数据字段：`created_by`（默认 `"zhoudabo"`）、`reviewed_by`（可空）。M0 无角色 UI、无鉴权（localhost/LAN 自托管）。
- Python 依赖全部带下限与上限（VidFlow KNW-EXP-002 教训：无上限依赖是定时炸弹）。
- 红线（不得引入）：OpenMetadata、Neo4j、Celery、多租户、自动上传（PRD §6/§7）。
- 搜索用 PostgreSQL `pg_trgm`（GIN 索引加速 ILIKE），中文按子串命中，M0 不引入独立搜索引擎。
- 提交遵循 Conventional Commits；`docs/` 下 md 改动会触发 docstd pre-commit 校验（本计划代码不涉及）。
- 每个任务 TDD：先写失败测试，再实现，再提交。

---

### Task 1: 后端脚手架 + docker-compose + 健康检查

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/app/__init__.py`（空）
- Create: `backend/app/config.py`
- Create: `backend/app/main.py`
- Create: `backend/tests/__init__.py`（空）
- Create: `backend/tests/test_health.py`
- Create: `docker-compose.yml`
- Create: `backend/Dockerfile`
- Create: `Makefile`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: 无（起点任务）
- Produces: `app.main:app`（FastAPI 实例，含 `GET /api/health`）；`app.config.settings`（字段：`database_url`、`minio_endpoint`、`minio_access_key`、`minio_secret_key`、`bucket_prefix`，环境变量前缀 `CH_`，读 `backend/.env`）；compose 服务名 `postgres`/`minio`/`api`/`frontend`

- [ ] **Step 1: 创建目录与 pyproject.toml**

```bash
mkdir -p backend/app backend/tests
```

`backend/pyproject.toml`：

```toml
[project]
name = "contenthub-backend"
version = "0.1.0"
description = "ContentHub M0 资产底座后端"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115,<1.0",
    "uvicorn[standard]>=0.30,<1.0",
    "sqlalchemy>=2.0,<3.0",
    "psycopg[binary]>=3.2,<4.0",
    "alembic>=1.13,<2.0",
    "pydantic>=2.7,<3.0",
    "pydantic-settings>=2.3,<3.0",
    "minio>=7.2,<8.0",
    "python-multipart>=0.0.9,<1.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0,<9.0",
    "httpx>=0.27,<1.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["app"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 2: 写 config.py 与 main.py**

`backend/app/config.py`：

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = (
        "postgresql+psycopg://contenthub:contenthub@localhost:5433/contenthub"
    )
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "contenthub"
    minio_secret_key: str = "contenthub123"
    bucket_prefix: str = "contenthub-"

    model_config = {"env_file": ".env", "env_prefix": "CH_"}


settings = Settings()
```

`backend/app/main.py`：

```python
from fastapi import FastAPI

app = FastAPI(title="ContentHub API", version="0.1.0")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "version": "0.1.0"}
```

- [ ] **Step 3: 写失败测试（test_health.py）**

`backend/tests/test_health.py`：

```python
from fastapi.testclient import TestClient

from app.main import app


def test_health_returns_ok():
    client = TestClient(app)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "version": "0.1.0"}
```

- [ ] **Step 4: 建虚拟环境、安装依赖、验证测试失败转通过**

```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/pytest tests/test_health.py -v
```

预期：`1 passed`。（若 app 尚未写则先失败——按步骤顺序先写代码后测试时，直接通过亦可；核心是本任务结束时此命令通过。）

- [ ] **Step 5: 写 docker-compose.yml 与后端 Dockerfile**

`docker-compose.yml`（仓库根目录）：

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: contenthub
      POSTGRES_PASSWORD: contenthub
      POSTGRES_DB: contenthub
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U contenthub"]
      interval: 5s
      timeout: 3s
      retries: 10

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: contenthub
      MINIO_ROOT_PASSWORD: contenthub123
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - miniodata:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 3s
      retries: 10

  api:
    build: ./backend
    environment:
      CH_DATABASE_URL: postgresql+psycopg://contenthub:contenthub@postgres:5432/contenthub
      CH_MINIO_ENDPOINT: minio:9000
      CH_MINIO_ACCESS_KEY: contenthub
      CH_MINIO_SECRET_KEY: contenthub123
    ports:
      - "8000:8000"
    depends_on:
      postgres:
        condition: service_healthy
      minio:
        condition: service_healthy

  frontend:
    build: ./frontend
    ports:
      - "8080:80"
    depends_on:
      - api

volumes:
  pgdata:
  miniodata:
```

`backend/Dockerfile`：

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml ./
COPY app ./app
COPY alembic.ini ./
COPY alembic ./alembic
RUN pip install --no-cache-dir .
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
```

（本任务先建 compose 的 postgres/minio 部分；`api`/`frontend` 服务定义现在写入，Task 2 补 alembic 后 `docker compose build api` 才会成功。）

- [ ] **Step 6: Makefile 与 .gitignore 追加**

`Makefile`（仓库根目录）：

```makefile
.PHONY: dev test up down import

dev:            ## 启动开发依赖（postgres + minio）
	docker compose up -d postgres minio

test:           ## 运行后端测试（需先 make dev）
	cd backend && .venv/bin/pytest -v

up:             ## 全栈构建并启动
	docker compose up -d --build

down:
	docker compose down

import:         ## 导入 Obsidian 库：make import VAULT="/path/to/【008】个人文章"
	cd backend && .venv/bin/python -m app.importer.obsidian --vault "$(VAULT)"
```

`.gitignore` 追加：

```
# Python
.venv/
__pycache__/
*.egg-info/

# Node
node_modules/
dist/

# 环境与本地输出
backend/.env
backend/dup-report.json
```

- [ ] **Step 7: 启动依赖并冒烟**

```bash
make dev && sleep 5 && docker compose ps
```

预期：postgres、minio 状态 `running (healthy)`。

- [ ] **Step 8: 提交**

```bash
git add backend docker-compose.yml Makefile .gitignore
git commit -m "feat: M0 后端脚手架与开发环境（FastAPI + compose + 健康检查）"
```

---

### Task 2: 数据模型 + Alembic 初始迁移（含 pg_trgm）

**Files:**
- Create: `backend/app/db.py`
- Create: `backend/app/models.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_models.py`
- Create: `backend/alembic.ini`、`backend/alembic/env.py`、`backend/alembic/versions/*_initial.py`（由 alembic 生成后编辑）
- Modify: `backend/Dockerfile` 无需改（已包含 alembic 路径）

**Interfaces:**
- Consumes: `app.config.settings`、`app.main:app`
- Produces:
  - `app.db.Base`（DeclarativeBase）、`app.db.get_db`（FastAPI 依赖，yield Session）
  - `app.models.Asset`（字段：`id: UUID`、`zone: AssetZone`、`status: AssetStatus`、`title: str`、`file_name: str|None`、`content_type: str`、`object_key: str|None`、`source_url: str|None`、`text_content: str|None`、`source_path: str|None`（唯一，导入幂等用）、`created_by: str`、`reviewed_by: str|None`、`meta: dict`、`created_at/updated_at: datetime`）
  - `app.models.Derivation`（字段：`id`、`source_asset_id`、`derived_asset_id`、`recipe_ref: str|None`（M1 配方预留）、`note: str|None`、`created_by`、`created_at`；`(source, derived)` 唯一约束）
  - `app.models.AssetZone`（source/master/publish）、`app.models.AssetStatus`（topic/drafting/finalized/publishing/published）、`app.models.TRANSITIONS: dict[AssetStatus, set[AssetStatus]]`
  - 测试夹具 `db_session`（conftest，函数级，每测试后 TRUNCATE）

- [ ] **Step 1: 写 db.py**

`backend/app/db.py`：

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 2: 写 models.py**

`backend/app/models.py`：

```python
import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AssetZone(str, enum.Enum):
    SOURCE = "source"    # 源料区（原子态）
    MASTER = "master"    # 母版区（编辑态）
    PUBLISH = "publish"  # 发布态（派生物）


class AssetStatus(str, enum.Enum):
    TOPIC = "topic"            # 选题
    DRAFTING = "drafting"      # 创作中
    FINALIZED = "finalized"    # 定稿
    PUBLISHING = "publishing"  # 发布中
    PUBLISHED = "published"    # 已发布


# 状态机（PRD-MVP-001 v2.0 §5 M0）：定稿可返工，发布中可撤回，published 为终态
TRANSITIONS: dict[AssetStatus, set[AssetStatus]] = {
    AssetStatus.TOPIC: {AssetStatus.DRAFTING},
    AssetStatus.DRAFTING: {AssetStatus.FINALIZED},
    AssetStatus.FINALIZED: {AssetStatus.DRAFTING, AssetStatus.PUBLISHING},
    AssetStatus.PUBLISHING: {AssetStatus.FINALIZED, AssetStatus.PUBLISHED},
    AssetStatus.PUBLISHED: set(),
}


class Asset(Base):
    __tablename__ = "assets"
    __table_args__ = (
        Index(
            "ix_assets_title_trgm",
            "title",
            postgresql_using="gin",
            postgresql_ops={"title": "gin_trgm_ops"},
        ),
        Index(
            "ix_assets_text_trgm",
            "text_content",
            postgresql_using="gin",
            postgresql_ops={"text_content": "gin_trgm_ops"},
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    zone: Mapped[AssetZone]
    status: Mapped[AssetStatus]
    title: Mapped[str] = mapped_column(String(500))
    file_name: Mapped[str | None] = mapped_column(String(500))
    content_type: Mapped[str] = mapped_column(String(20), default="other")
    object_key: Mapped[str | None] = mapped_column(String(1000))
    source_url: Mapped[str | None] = mapped_column(String(2000))
    text_content: Mapped[str | None] = mapped_column(Text)
    source_path: Mapped[str | None] = mapped_column(String(1000), unique=True)
    created_by: Mapped[str] = mapped_column(String(100), default="zhoudabo")
    reviewed_by: Mapped[str | None] = mapped_column(String(100))
    meta: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    # 该资产由谁派生而来（上游）
    upstream = relationship(
        "Derivation",
        foreign_keys="Derivation.derived_asset_id",
        back_populates="derived",
        cascade="all, delete-orphan",
    )
    # 该资产派生出什么（下游）
    downstream = relationship(
        "Derivation",
        foreign_keys="Derivation.source_asset_id",
        back_populates="source",
        cascade="all, delete-orphan",
    )


class Derivation(Base):
    __tablename__ = "derivations"
    __table_args__ = (
        UniqueConstraint("source_asset_id", "derived_asset_id", name="uq_derivation_pair"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    source_asset_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assets.id", ondelete="CASCADE")
    )
    derived_asset_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assets.id", ondelete="CASCADE")
    )
    recipe_ref: Mapped[str | None] = mapped_column(String(200))  # M1 配方预留
    note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str] = mapped_column(String(100), default="zhoudabo")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    source = relationship("Asset", foreign_keys=[source_asset_id], back_populates="downstream")
    derived = relationship("Asset", foreign_keys=[derived_asset_id], back_populates="upstream")
```

- [ ] **Step 3: 写 conftest.py 与模型/状态机测试（先失败）**

`backend/tests/conftest.py`：

```python
import pytest
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from app.db import Base, engine


@pytest.fixture(scope="session", autouse=True)
def _schema():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture()
def db_session():
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    db = factory()
    yield db
    db.rollback()
    db.execute(text("TRUNCATE assets, derivations CASCADE"))
    db.commit()
    db.close()
```

注意：测试直连 compose 里的 postgres（`make dev` 先行）。pg_trgm 扩展不在 `create_all` 里建，TRGM 索引在纯测试建表时会以普通声明失败吗——`Index(..., postgresql_using="gin", postgresql_ops=...)` 在无扩展时 `create_all` 会报错。因此 conftest `_schema` 里先执行：

```python
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
```

（把这三行加在 `drop_all` 之前。）

`backend/tests/test_models.py`：

```python
import pytest

from app.models import (
    Asset,
    AssetStatus,
    AssetZone,
    Derivation,
    TRANSITIONS,
)


def test_transition_table_matches_prd():
    assert TRANSITIONS[AssetStatus.TOPIC] == {AssetStatus.DRAFTING}
    assert TRANSITIONS[AssetStatus.DRAFTING] == {AssetStatus.FINALIZED}
    assert TRANSITIONS[AssetStatus.FINALIZED] == {
        AssetStatus.DRAFTING,
        AssetStatus.PUBLISHING,
    }
    assert TRANSITIONS[AssetStatus.PUBLISHING] == {
        AssetStatus.FINALIZED,
        AssetStatus.PUBLISHED,
    }
    assert TRANSITIONS[AssetStatus.PUBLISHED] == set()


def test_asset_roundtrip(db_session):
    a = Asset(
        zone=AssetZone.MASTER,
        status=AssetStatus.DRAFTING,
        title="跨品牌售后：浪潮之下冷暖自知",
        content_type="markdown",
        text_content="168 元保养 299 元漆面",
    )
    db_session.add(a)
    db_session.flush()

    got = db_session.get(Asset, a.id)
    assert got.zone is AssetZone.MASTER
    assert got.status is AssetStatus.DRAFTING
    assert got.created_by == "zhoudabo"


def test_derivation_pair_unique(db_session):
    m = Asset(zone=AssetZone.MASTER, status=AssetStatus.FINALIZED, title="母版", content_type="markdown")
    p = Asset(zone=AssetZone.PUBLISH, status=AssetStatus.PUBLISHING, title="公众号版", content_type="markdown")
    db_session.add_all([m, p])
    db_session.flush()
    db_session.add(Derivation(source_asset_id=m.id, derived_asset_id=p.id))
    db_session.flush()
    db_session.add(Derivation(source_asset_id=m.id, derived_asset_id=p.id))
    with pytest.raises(Exception):
        db_session.flush()
```

- [ ] **Step 4: 运行测试（先失败后通过）**

```bash
cd backend && .venv/bin/pytest tests/test_models.py -v
```

预期：models 未实现时 `ModuleNotFoundError`；实现后 `3 passed`。

- [ ] **Step 5: 初始化 Alembic 并生成初始迁移**

```bash
cd backend && .venv/bin/pip install -e ".[dev]" && .venv/bin/alembic init alembic
```

替换 `backend/alembic/env.py` 为：

```python
from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import settings
from app.db import Base
from app import models  # noqa: F401 确保模型注册

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

生成迁移：

```bash
.venv/bin/alembic revision --autogenerate -m "initial"
```

打开生成的 `alembic/versions/*_initial.py`，在 `upgrade()` **顶部**插入一行（autogenerate 不会建扩展）：

```python
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
```

然后对**全新库**执行迁移验证（先删测试建的表，或直接对 compose 库执行）：

```bash
docker compose exec postgres psql -U contenthub -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
.venv/bin/alembic upgrade head
docker compose exec postgres psql -U contenthub -c "\dt"
```

预期输出包含 `assets`、`derivations`；`\di` 可见 `ix_assets_title_trgm`。

- [ ] **Step 6: 提交**

```bash
git add backend
git commit -m "feat: M0 数据模型与初始迁移（assets/derivations + pg_trgm）"
```

---

### Task 3: 对象存储层（MinIO 实现 + 测试假实现）

**Files:**
- Create: `backend/app/storage.py`
- Create: `backend/tests/test_storage.py`

**Interfaces:**
- Consumes: `app.config.settings`
- Produces: `app.storage.ObjectStorage`（Protocol：`ensure_buckets()`、`put(zone, key, data: bytes, content_type: str)`、`put_stream(zone, key, fileobj, length: int, content_type: str)`、`presigned_get(zone, key, expires_seconds=3600) -> str`、`delete(zone, key)`）；`app.storage.MinioStorage(endpoint, access_key, secret_key, prefix, secure=False)`；`app.storage.FakeStorage`；`app.storage.get_storage`（FastAPI 依赖，单例，首次调用 ensure_buckets）

- [ ] **Step 1: 写失败测试**

`backend/tests/test_storage.py`：

```python
from app.storage import FakeStorage


def test_fake_storage_roundtrip():
    s = FakeStorage()
    s.ensure_buckets()
    s.put("master", "abc/cover.png", b"pngbytes", "image/png")
    assert s.get("master", "abc/cover.png") == b"pngbytes"
    assert s.presigned_get("master", "abc/cover.png").startswith("fake://")
    s.delete("master", "abc/cover.png")
    assert s.get("master", "abc/cover.png") is None
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd backend && .venv/bin/pytest tests/test_storage.py -v
```

预期：`ModuleNotFoundError: app.storage`。

- [ ] **Step 3: 实现 storage.py**

`backend/app/storage.py`：

```python
from io import BytesIO
from typing import Protocol

from minio import Minio

from .config import settings

ZONES = ("source", "master", "publish")


class ObjectStorage(Protocol):
    def ensure_buckets(self) -> None: ...
    def put(self, zone: str, key: str, data: bytes, content_type: str) -> None: ...
    def put_stream(self, zone: str, key: str, fileobj, length: int, content_type: str) -> None: ...
    def presigned_get(self, zone: str, key: str, expires_seconds: int = 3600) -> str: ...
    def delete(self, zone: str, key: str) -> None: ...


class MinioStorage:
    def __init__(self, endpoint: str, access_key: str, secret_key: str,
                 prefix: str, secure: bool = False):
        self.client = Minio(endpoint, access_key=access_key,
                            secret_key=secret_key, secure=secure)
        self.buckets = {z: f"{prefix}{z}" for z in ZONES}

    def ensure_buckets(self) -> None:
        for name in self.buckets.values():
            if not self.client.bucket_exists(name):
                self.client.make_bucket(name)

    def put(self, zone: str, key: str, data: bytes, content_type: str) -> None:
        self.client.put_object(self.buckets[zone], key, BytesIO(data),
                               length=len(data), content_type=content_type)

    def put_stream(self, zone: str, key: str, fileobj, length: int,
                   content_type: str) -> None:
        self.client.put_object(self.buckets[zone], key, fileobj,
                               length=length, content_type=content_type)

    def presigned_get(self, zone: str, key: str, expires_seconds: int = 3600) -> str:
        from datetime import timedelta
        return self.client.presigned_get_object(
            self.buckets[zone], key, expires=timedelta(seconds=expires_seconds)
        )

    def delete(self, zone: str, key: str) -> None:
        self.client.remove_object(self.buckets[zone], key)


class FakeStorage:
    """内存实现，供单测使用（不依赖真实 MinIO）。"""

    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def ensure_buckets(self) -> None: ...
    def put(self, zone: str, key: str, data: bytes, content_type: str) -> None:
        self.objects[(zone, key)] = data
    def put_stream(self, zone: str, key: str, fileobj, length: int,
                   content_type: str) -> None:
        self.objects[(zone, key)] = fileobj.read()
    def get(self, zone: str, key: str) -> bytes | None:
        return self.objects.get((zone, key))
    def presigned_get(self, zone: str, key: str, expires_seconds: int = 3600) -> str:
        return f"fake://{zone}/{key}"
    def delete(self, zone: str, key: str) -> None:
        self.objects.pop((zone, key), None)


_storage: ObjectStorage | None = None


def get_storage() -> ObjectStorage:
    global _storage
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

- [ ] **Step 4: 测试通过 + 真实 MinIO 冒烟**

```bash
.venv/bin/pytest tests/test_storage.py -v
```

预期：`1 passed`。

真实 MinIO 冒烟（验证 ensure_buckets 建桶）：

```bash
.venv/bin/python -c "
from app.storage import MinioStorage
from app.config import settings
s = MinioStorage(settings.minio_endpoint, settings.minio_access_key, settings.minio_secret_key, settings.bucket_prefix)
s.ensure_buckets()
print(sorted(s.buckets.values()))
"
```

预期：`['contenthub-master', 'contenthub-publish', 'contenthub-source']`。

- [ ] **Step 5: 提交**

```bash
git add backend/app/storage.py backend/tests/test_storage.py
git commit -m "feat: M0 对象存储层（MinIO + Fake 双实现）"
```

---

### Task 4: 资产 API（上传/外链/列表检索/详情/状态流转/删除）

**Files:**
- Create: `backend/app/schemas.py`
- Create: `backend/app/routers/__init__.py`（空）
- Create: `backend/app/routers/assets.py`
- Modify: `backend/app/main.py`（挂载路由 + lifespan 预热存储）
- Create: `backend/tests/test_assets_api.py`

**Interfaces:**
- Consumes: `get_db`、`get_storage`、`Asset`/`TRANSITIONS`、`FakeStorage`
- Produces（后续任务与前端依赖）:
  - `POST /api/assets`：multipart 表单 `zone`、`title`、`file`、可选 `created_by` → 201 `AssetOut`；`zone=publish` → 422
  - `POST /api/assets/external`：JSON `{zone, title, source_url, meta?}`（zone 仅 source）→ 201 `AssetOut`
  - `GET /api/assets?zone=&status=&q=&limit=&offset=` → `list[AssetOut]`（`q` 对 title/text_content 做 ILIKE 全文检索）
  - `GET /api/assets/{id}` → `AssetDetail`（含 `upstream`/`downstream`/`file_url`）
  - `PATCH /api/assets/{id}/status`：JSON `{status}` → `AssetOut`；非法转换 422
  - `DELETE /api/assets/{id}` → 204（连带删除对象与派生关系）
  - schemas：`AssetOut`、`AssetDetail`、`AssetExternalCreate`、`StatusUpdate`、`DerivationOut`

- [ ] **Step 1: 写 schemas.py**

`backend/app/schemas.py`：

```python
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, HttpUrl

from .models import AssetStatus, AssetZone


class AssetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    zone: AssetZone
    status: AssetStatus
    title: str
    file_name: str | None = None
    content_type: str
    object_key: str | None = None
    source_url: str | None = None
    created_by: str
    reviewed_by: str | None = None
    meta: dict
    created_at: datetime
    updated_at: datetime


class DerivationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_asset_id: uuid.UUID
    derived_asset_id: uuid.UUID
    recipe_ref: str | None = None
    note: str | None = None
    created_by: str
    created_at: datetime


class AssetDetail(AssetOut):
    upstream: list[DerivationOut] = []
    downstream: list[DerivationOut] = []
    file_url: str | None = None


class AssetExternalCreate(BaseModel):
    zone: Literal[AssetZone.SOURCE]
    title: str
    source_url: HttpUrl
    meta: dict = {}


class StatusUpdate(BaseModel):
    status: AssetStatus


class DerivationCreate(BaseModel):
    source_asset_id: uuid.UUID
    recipe_ref: str | None = None
    note: str | None = None
```

- [ ] **Step 2: 写失败测试（test_assets_api.py）**

`backend/tests/test_assets_api.py`：

```python
import io

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.db import Base, engine, get_db
from app.main import app
from app.storage import FakeStorage, get_storage


@pytest.fixture()
def client(db_session):
    def _override_get_db():
        yield db_session

    fake = FakeStorage()
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


def test_upload_source_defaults_to_topic(client):
    resp = client.post(
        "/api/assets",
        data={"zone": "source", "title": "信源"},
        files=_md_file(),
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "topic"


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
```

- [ ] **Step 3: 运行确认失败**

```bash
cd backend && .venv/bin/pytest tests/test_assets_api.py -v
```

预期：路由未实现 → 多数用例 404/失败。

- [ ] **Step 4: 实现 routers/assets.py**

`backend/app/routers/assets.py`：

```python
import shutil
import tempfile
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Asset, AssetStatus, AssetZone, TRANSITIONS
from ..schemas import (
    AssetDetail,
    AssetExternalCreate,
    AssetOut,
    DerivationOut,
    StatusUpdate,
)
from ..storage import get_storage

router = APIRouter(prefix="/api/assets", tags=["assets"])

MAX_UPLOAD_BYTES = 2 * 1024**3  # 2GB（视频母版）
INLINE_TEXT_LIMIT = 50 * 1024**2  # 50MB 以下走内存并抽取文本

EXT_CONTENT_TYPE = {
    ".md": "markdown", ".markdown": "markdown",
    ".png": "image", ".jpg": "image", ".jpeg": "image",
    ".webp": "image", ".gif": "image", ".heic": "image",
    ".mov": "video", ".mp4": "video",
    ".wav": "audio", ".mp3": "audio",
}
INITIAL_STATUS = {
    AssetZone.SOURCE: AssetStatus.TOPIC,
    AssetZone.MASTER: AssetStatus.DRAFTING,
}


def content_type_for(file_name: str) -> str:
    suffix = "." + file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    return EXT_CONTENT_TYPE.get(suffix, "other")


def get_asset_or_404(db: Session, asset_id: uuid.UUID) -> Asset:
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(404, f"资产不存在：{asset_id}")
    return asset


@router.post("", status_code=201, response_model=AssetOut)
async def create_asset(
    zone: AssetZone = Form(...),
    title: str = Form(...),
    file: UploadFile = File(...),
    created_by: str = Form("zhoudabo"),
    db: Session = Depends(get_db),
    storage=Depends(get_storage),
):
    if zone == AssetZone.PUBLISH:
        raise HTTPException(
            422, "发布态资产须由母版派生：POST /api/assets/{master_id}/derive"
        )
    file_name = file.filename or "untitled"
    ct = content_type_for(file_name)
    asset = Asset(
        zone=zone,
        status=INITIAL_STATUS[zone],
        title=title,
        file_name=file_name,
        content_type=ct,
        created_by=created_by,
    )
    db.add(asset)
    db.flush()
    key = f"{asset.id}/{file_name}"

    # UploadFile 已在磁盘 spill；读头部判定大小，小文件进内存并抽文本，大文件流式
    data = await file.read(INLINE_TEXT_LIMIT + 1)
    if len(data) <= INLINE_TEXT_LIMIT:
        storage.put(zone, key, data, file.content_type or "application/octet-stream")
        if ct == "markdown":
            asset.text_content = data.decode("utf-8", errors="ignore")
    else:
        with tempfile.SpooledTemporaryFile(max_size=64 * 1024 * 1024) as tmp:
            tmp.write(data)
            shutil.copyfileobj(file.file, tmp)
            size = tmp.tell()
            if size > MAX_UPLOAD_BYTES:
                db.rollback()
                raise HTTPException(413, f"文件超过上限 {MAX_UPLOAD_BYTES} 字节")
            tmp.seek(0)
            storage.put_stream(zone, key, tmp, size,
                               file.content_type or "application/octet-stream")
    asset.object_key = key
    db.commit()
    db.refresh(asset)
    return asset


@router.post("/external", status_code=201, response_model=AssetOut)
def create_external(body: AssetExternalCreate, db: Session = Depends(get_db)):
    asset = Asset(
        zone=AssetZone.SOURCE,
        status=AssetStatus.TOPIC,
        title=body.title,
        content_type="link",
        source_url=str(body.source_url),
        meta=body.meta,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


@router.get("", response_model=list[AssetOut])
def list_assets(
    zone: AssetZone | None = None,
    status: AssetStatus | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    stmt = select(Asset).order_by(Asset.updated_at.desc()).limit(min(limit, 200)).offset(offset)
    if zone:
        stmt = stmt.where(Asset.zone == zone)
    if status:
        stmt = stmt.where(Asset.status == status)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            Asset.title.ilike(like) | Asset.text_content.ilike(like)
        )
    return list(db.scalars(stmt))


@router.get("/{asset_id}", response_model=AssetDetail)
def get_asset(asset_id: uuid.UUID, db: Session = Depends(get_db),
              storage=Depends(get_storage)):
    asset = get_asset_or_404(db, asset_id)
    detail = AssetDetail.model_validate(asset)
    detail.upstream = [DerivationOut.model_validate(d) for d in asset.upstream]
    detail.downstream = [DerivationOut.model_validate(d) for d in asset.downstream]
    if asset.object_key:
        detail.file_url = storage.presigned_get(asset.zone.value, asset.object_key)
    return detail


@router.patch("/{asset_id}/status", response_model=AssetOut)
def update_status(asset_id: uuid.UUID, body: StatusUpdate,
                  db: Session = Depends(get_db)):
    asset = get_asset_or_404(db, asset_id)
    allowed = TRANSITIONS[asset.status]
    if body.status not in allowed:
        raise HTTPException(
            422,
            f"非法状态转换 {asset.status.value} → {body.status.value}；"
            f"允许 → {sorted(s.value for s in allowed)}",
        )
    asset.status = body.status
    db.commit()
    db.refresh(asset)
    return asset


@router.delete("/{asset_id}", status_code=204)
def delete_asset(asset_id: uuid.UUID, db: Session = Depends(get_db),
                 storage=Depends(get_storage)):
    asset = get_asset_or_404(db, asset_id)
    if asset.object_key:
        storage.delete(asset.zone.value, asset.object_key)
    db.delete(asset)
    db.commit()
```

修改 `backend/app/main.py` 挂载路由：

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .routers import assets


@asynccontextmanager
async def lifespan(app: FastAPI):
    from .storage import get_storage
    get_storage()  # 启动即建桶，失败早暴露
    yield


app = FastAPI(title="ContentHub API", version="0.1.0", lifespan=lifespan)
app.include_router(assets.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "version": "0.1.0"}
```

注意：单测的 TestClient 会触发 lifespan 里的真实 MinioStorage——测试中依赖被 override，但 lifespan 仍会连 MinIO。为避免测试依赖真实 MinIO，将 lifespan 改为惰性（去掉 lifespan，改为 `ensure_buckets` 仅在 `get_storage` 单例首调时执行），即 **main.py 不使用 lifespan**，保持：

```python
from fastapi import FastAPI

from .routers import assets

app = FastAPI(title="ContentHub API", version="0.1.0")
app.include_router(assets.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "version": "0.1.0"}
```

（compose 的 api 容器启动后首次请求自动建桶。）

- [ ] **Step 5: 运行测试通过**

```bash
.venv/bin/pytest tests/test_assets_api.py -v
```

预期：`7 passed`。

- [ ] **Step 6: 提交**

```bash
git add backend
git commit -m "feat: M0 资产 API（上传/外链/检索/详情/状态机/删除）"
```

---

### Task 5: 派生关系 API（derive + link，区规则强制）

**Files:**
- Modify: `backend/app/routers/assets.py`（追加两个端点）
- Create: `backend/tests/test_derivations_api.py`

**Interfaces:**
- Consumes: Task 4 全部
- Produces:
  - `POST /api/assets/{master_id}/derive`：multipart `title`、`platform`、`file`、可选 `recipe_ref` → 201 `AssetDetail`；仅 master 可派生；新资产 zone=publish、status=publishing，并自动写入 Derivation
  - `POST /api/assets/{asset_id}/derivations`：JSON `DerivationCreate`（asset_id 为**被派生**方）→ 201 `DerivationOut`；区规则 `source→publish` 禁止 422；重复关系 409

- [ ] **Step 1: 写失败测试**

`backend/tests/test_derivations_api.py`：

```python
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
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && .venv/bin/pytest tests/test_derivations_api.py -v
```

预期：404（端点不存在）。

- [ ] **Step 3: 在 routers/assets.py 追加实现**

在文件末尾追加：

```python
ALLOWED_DERIVATION_ZONES = {
    (AssetZone.SOURCE, AssetZone.MASTER),
    (AssetZone.MASTER, AssetZone.MASTER),
    (AssetZone.MASTER, AssetZone.PUBLISH),
}


@router.post("/{master_id}/derive", status_code=201, response_model=AssetDetail)
async def derive_from_master(
    master_id: uuid.UUID,
    title: str = Form(...),
    platform: str = Form(...),
    file: UploadFile = File(...),
    recipe_ref: str | None = Form(None),
    db: Session = Depends(get_db),
    storage=Depends(get_storage),
):
    master = get_asset_or_404(db, master_id)
    if master.zone != AssetZone.MASTER:
        raise HTTPException(422, f"仅母版可派生，当前 zone={master.zone.value}")

    file_name = file.filename or "untitled"
    ct = content_type_for(file_name)
    pub = Asset(
        zone=AssetZone.PUBLISH,
        status=AssetStatus.PUBLISHING,
        title=title,
        file_name=file_name,
        content_type=ct,
        created_by=master.created_by,
        meta={"platform": platform},
    )
    db.add(pub)
    db.flush()
    key = f"{pub.id}/{file_name}"
    data = await file.read()
    storage.put(AssetZone.PUBLISH, key, data, file.content_type or "application/octet-stream")
    pub.object_key = key
    if ct == "markdown":
        pub.text_content = data.decode("utf-8", errors="ignore")

    db.add(Derivation(source_asset_id=master.id, derived_asset_id=pub.id,
                      recipe_ref=recipe_ref, created_by=master.created_by))
    db.commit()
    db.refresh(pub)
    detail = AssetDetail.model_validate(pub)
    detail.upstream = [DerivationOut.model_validate(d) for d in pub.upstream]
    return detail


@router.post("/{asset_id}/derivations", status_code=201, response_model=DerivationOut)
def link_derivation(asset_id: uuid.UUID, body: DerivationCreate,
                    db: Session = Depends(get_db)):
    derived = get_asset_or_404(db, asset_id)
    source = get_asset_or_404(db, body.source_asset_id)
    if (source.zone, derived.zone) not in ALLOWED_DERIVATION_ZONES:
        raise HTTPException(
            422,
            f"派生区规则禁止 {source.zone.value} → {derived.zone.value}"
            "（发布态必须派生自母版）",
        )
    exists = db.scalar(
        select(Derivation).where(
            Derivation.source_asset_id == source.id,
            Derivation.derived_asset_id == derived.id,
        )
    )
    if exists:
        raise HTTPException(409, "派生关系已存在")
    d = Derivation(source_asset_id=source.id, derived_asset_id=derived.id,
                   recipe_ref=body.recipe_ref, note=body.note)
    db.add(d)
    db.commit()
    db.refresh(d)
    return d
```

同时在文件头部 import 中补 `Derivation`（来自 `..models`）与 `select`（已在 Task 4 import）。

- [ ] **Step 4: 运行全部测试通过**

```bash
.venv/bin/pytest -v
```

预期：此前全部 + 新增 `5 passed`（此任务），总计 15 passed。

- [ ] **Step 5: 提交**

```bash
git add backend
git commit -m "feat: M0 派生关系 API（derive 自动血缘 + link 区规则强制）"
```

---

### Task 6: Obsidian 批量导入器 + 同题重复报告

**Files:**
- Create: `backend/app/importer/__init__.py`（空）
- Create: `backend/app/importer/obsidian.py`
- Create: `backend/tests/test_importer.py`

**Interfaces:**
- Consumes: `Asset`、`AssetZone/AssetStatus`、`ObjectStorage`、`db_session`
- Produces:
  - `import_vault(vault: Path, db, storage, dry_run=False, mapping=DEFAULT_MAP) -> ImportResult`（dataclass：`imported: int`、`skipped: int`、`missing_dirs: list[str]`）
  - `duplicate_report(db, threshold=0.45) -> list[dict]`（每组：`{"ids": [...], "titles": [...], "ratio": float}`，仅对 MASTER 资产两两 difflib 比对）
  - CLI：`python -m app.importer.obsidian --vault <path> [--dry-run] [--report out.json]`
  - `DEFAULT_MAP`：选题策划→source:topic；公众号文章草稿→master:drafting；定稿发表→master:published；读书笔记/八字分析/个人→source:topic
  - 幂等：按 `Asset.source_path`（vault 内相对路径）跳过已导入
  - 提示词文件（文件名含"提示词"）→ `meta={"kind": "recipe"}`（M1 配方库认领）

- [ ] **Step 1: 写失败测试**

`backend/tests/test_importer.py`：

```python
from pathlib import Path

from app.importer.obsidian import DEFAULT_MAP, duplicate_report, import_vault
from app.models import Asset, AssetStatus, AssetZone
from app.storage import FakeStorage


def _make_vault(root: Path):
    plan = root / "选题策划"
    draft = root / "公众号文章草稿"
    final = root / "定稿发表"
    for d in (plan, draft, final):
        d.mkdir(parents=True)

    (plan / "选题提示词.md").write_text("---\ntitle: 选题提示词\n---\n角色定义……", encoding="utf-8")
    (plan / "2026年09月04日选题策划.md").write_text("# 第 37 期选题\n母题清单……", encoding="utf-8")
    (draft / "2026年5月10日-车企跨品牌售后.md").write_text(
        "---\ntitle: 车企跨品牌售后：浪潮之下冷暖自知\n---\n\n168 元保养。", encoding="utf-8")
    (draft / "2026年05月10日-车企跨品牌售后.md").write_text("近似修订版。", encoding="utf-8")
    (draft / "2026年5月10日-车企跨品牌售后-口播稿.md").write_text("口播版。", encoding="utf-8")
    (final / "20260213 汽车行业的营销必然AI化.md").write_text("已发表正文。", encoding="utf-8")


def test_import_maps_zones_and_statuses(db_session, tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    _make_vault(vault)
    result = import_vault(vault, db_session, FakeStorage())

    assert result.imported == 6
    assert result.missing_dirs == []

    assets = db_session.query(Asset).all()
    by_path = {a.source_path: a for a in assets}
    assert by_path["选题策划/2026年09月04日选题策划.md"].zone is AssetZone.SOURCE
    assert by_path["选题策划/2026年09月04日选题策划.md"].status is AssetStatus.TOPIC
    assert by_path["公众号文章草稿/2026年5月10日-车企跨品牌售后.md"].zone is AssetZone.MASTER
    assert by_path["公众号文章草稿/2026年5月10日-车企跨品牌售后.md"].status is AssetStatus.DRAFTING
    assert by_path["定稿发表/20260213 汽车行业的营销必然AI化.md"].status is AssetStatus.PUBLISHED
    # frontmatter title 优先于文件名
    assert by_path["公众号文章草稿/2026年5月10日-车企跨品牌售后.md"].title == "车企跨品牌售后：浪潮之下冷暖自知"


def test_recipe_files_flagged(db_session, tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    _make_vault(vault)
    import_vault(vault, db_session, FakeStorage())
    a = db_session.query(Asset).filter(Asset.source_path.like("选题策划/%提示词%")).one()
    assert a.meta == {"kind": "recipe"}


def test_reimport_idempotent(db_session, tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    _make_vault(vault)
    storage = FakeStorage()
    first = import_vault(vault, db_session, storage)
    second = import_vault(vault, db_session, storage)
    assert first.imported == 6
    assert second.imported == 0
    assert second.skipped == 6


def test_duplicate_report_groups_same_topic(db_session, tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    _make_vault(vault)
    import_vault(vault, db_session, FakeStorage())
    groups = duplicate_report(db_session)
    assert groups, "应检出至少一组同题疑似副本"
    all_ids = {i for g in groups for i in g["ids"]}
    n = db_session.query(Asset).filter(Asset.source_path.like("公众号文章草稿/2026年%售后%")).count()
    assert len(all_ids & {
        a.id for a in db_session.query(Asset).filter(Asset.source_path.like("公众号文章草稿/2026年%售后%"))
    }) >= 2
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && .venv/bin/pytest tests/test_importer.py -v
```

预期：`ModuleNotFoundError: app.importer`。

- [ ] **Step 3: 实现 obsidian.py**

`backend/app/importer/obsidian.py`：

```python
"""Obsidian 笔记库批量导入器（M0）。

用法：
    python -m app.importer.obsidian --vault "/path/to/【008】个人文章" [--dry-run] [--report out.json]

默认目录映射（--map 目录=zone:status 可覆盖，可多次）：
    选题策划=source:topic  公众号文章草稿=master:drafting  定稿发表=master:published
    读书笔记=source:topic  八字分析=source:topic  个人=source:topic
"""
import argparse
import difflib
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Asset, AssetStatus, AssetZone
from ..storage import ObjectStorage

DEFAULT_MAP: dict[str, tuple[AssetZone, AssetStatus]] = {
    "选题策划": (AssetZone.SOURCE, AssetStatus.TOPIC),
    "公众号文章草稿": (AssetZone.MASTER, AssetStatus.DRAFTING),
    "定稿发表": (AssetZone.MASTER, AssetStatus.PUBLISHED),
    "读书笔记": (AssetZone.SOURCE, AssetStatus.TOPIC),
    "八字分析": (AssetZone.SOURCE, AssetStatus.TOPIC),
    "个人": (AssetZone.SOURCE, AssetStatus.TOPIC),
}

FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)


@dataclass
class ImportResult:
    imported: int = 0
    skipped: int = 0
    missing_dirs: list[str] = field(default_factory=list)


def parse_frontmatter(text: str) -> dict:
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}
    fm = {}
    for line in m.group(1).splitlines():
        if ":" in line and not line.startswith((" ", "-", "\t")):
            k, _, v = line.partition(":")
            fm[k.strip()] = v.strip().strip('"').strip("'")
    return fm


def guess_title(path: Path, fm: dict, text: str) -> str:
    if fm.get("title"):
        return fm["title"]
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip() or path.stem
    return path.stem


def strip_frontmatter(text: str) -> str:
    return FRONTMATTER_RE.sub("", text, count=1)


def content_type_for(name: str) -> str:
    from ..routers.assets import EXT_CONTENT_TYPE
    return EXT_CONTENT_TYPE.get(name.rsplit(".", 1)[-1].lower(), "other") \
        if "." in name else "other"


def _with_dot(suffix: str) -> str:
    return f".{suffix}"


def import_vault(vault: Path, db: Session, storage: ObjectStorage,
                 dry_run: bool = False,
                 mapping: dict[str, tuple[AssetZone, AssetStatus]] | None = None) -> ImportResult:
    result = ImportResult()
    mapping = mapping or DEFAULT_MAP
    for dir_name, (zone, status) in mapping.items():
        dir_path = vault / dir_name
        if not dir_path.exists():
            result.missing_dirs.append(dir_name)
            continue
        for path in sorted(dir_path.rglob("*")):
            if path.is_dir() or path.name.startswith("."):
                continue
            rel = f"{dir_name}/{path.relative_to(dir_path).as_posix()}"
            exists = db.scalar(select(Asset).where(Asset.source_path == rel))
            if exists:
                result.skipped += 1
                continue
            data = path.read_bytes()
            text = data.decode("utf-8", errors="ignore")
            fm = parse_frontmatter(text)
            meta = {"kind": "recipe"} if "提示词" in path.stem else {}
            if dry_run:
                print(f"[dry-run] {zone.value}:{status.value} {rel}")
                result.imported += 1
                continue
            asset = Asset(
                zone=zone,
                status=status,
                title=guess_title(path, fm, text),
                file_name=path.name,
                content_type=("markdown" if path.suffix == ".md" else content_type_for(path.name)),
                text_content=strip_frontmatter(text) if path.suffix == ".md" else None,
                source_path=rel,
                meta=meta,
            )
            db.add(asset)
            db.flush()
            storage.put(zone.value, f"{asset.id}/{path.name}", data,
                        "text/markdown" if path.suffix == ".md" else "application/octet-stream")
            asset.object_key = f"{asset.id}/{path.name}"
            result.imported += 1
    if not dry_run:
        db.commit()
    return result


def duplicate_report(db: Session, threshold: float = 0.45) -> list[dict]:
    """对 MASTER 资产标题两两比对（difflib），输出疑似同题副本组。"""
    masters = list(db.scalars(select(Asset).where(Asset.zone == AssetZone.MASTER)))
    groups: list[dict] = []
    used: set[int] = set()
    for i, a in enumerate(masters):
        if id(a) in used:
            continue
        group = [a]
        for b in masters[i + 1:]:
            if id(b) in used:
                continue
            ratio = difflib.SequenceMatcher(None, a.title, b.title).ratio()
            if ratio >= threshold:
                group.append(b)
        if len(group) > 1:
            for g in group:
                used.add(id(g))
            ratios = [
                difflib.SequenceMatcher(None, group[0].title, g.title).ratio()
                for g in group[1:]
            ]
            groups.append({
                "ids": [str(g.id) for g in group],
                "titles": [g.title for g in group],
                "ratio": round(max(ratios), 2),
            })
    return groups


def main() -> int:
    parser = argparse.ArgumentParser(description="Obsidian 笔记库批量导入")
    parser.add_argument("--vault", required=True, type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--report", type=Path, default=None, help="重复报告输出 JSON 路径")
    parser.add_argument("--map", action="append", default=[],
                        help="覆盖映射：目录=zone:status（可多次）")
    args = parser.parse_args()

    mapping = dict(DEFAULT_MAP)
    for m in args.map:
        dir_name, _, rest = m.partition("=")
        zone, _, status = rest.partition(":")
        mapping[dir_name] = (AssetZone(zone), AssetStatus(status))

    from ..db import SessionLocal
    from ..storage import get_storage

    db = SessionLocal()
    storage = get_storage()
    result = import_vault(args.vault, db, storage, dry_run=args.dry_run, mapping=mapping)
    print(f"导入 {result.imported}，跳过 {result.skipped}，缺失目录 {result.missing_dirs}")
    if args.report:
        report = duplicate_report(db)
        args.report.write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"疑似同题副本 {len(report)} 组 → {args.report}")
    db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

（实现时删除示例中无用的 `_with_dot` 辅助与 `content_type_for` 里对无后缀文件的处理冗余，保持与上面主体一致即可——非 md 文件统一 `other`。）

- [ ] **Step 4: 运行测试通过**

```bash
.venv/bin/pytest tests/test_importer.py -v
```

预期：`4 passed`。

- [ ] **Step 5: 提交**

```bash
git add backend
git commit -m "feat: M0 Obsidian 批量导入器（目录映射/幂等/配方标记/同题报告）"
```

---

### Task 7: 前端最小界面 + 全栈 compose

**Files:**
- Create: `frontend/`（Vite react-ts 脚手架 + 覆盖文件）
- Create: `frontend/Dockerfile`、`frontend/nginx.conf`

**Interfaces:**
- Consumes: Task 4/5 的全部 HTTP API（同源 `/api` 经 nginx 反代）
- Produces: `http://localhost:8080` 可用的单页应用（列表/筛选/搜索/上传/详情/状态流转/派生/补链/删除）

- [ ] **Step 1: 脚手架**

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend && npm install && npm run build
```

预期：构建成功（脚手架原样可构建）。

- [ ] **Step 2: 覆盖核心文件**

`frontend/src/types.ts`：

```typescript
export type Zone = "source" | "master" | "publish";
export type Status = "topic" | "drafting" | "finalized" | "publishing" | "published";

export const TRANSITIONS: Record<Status, Status[]> = {
  topic: ["drafting"],
  drafting: ["finalized"],
  finalized: ["drafting", "publishing"],
  publishing: ["finalized", "published"],
  published: [],
};

export interface Asset {
  id: string;
  zone: Zone;
  status: Status;
  title: string;
  file_name: string | null;
  content_type: string;
  source_url: string | null;
  created_by: string;
  meta: Record<string, unknown>;
  updated_at: string;
}

export interface Derivation {
  id: string;
  source_asset_id: string;
  derived_asset_id: string;
  recipe_ref: string | null;
  note: string | null;
}

export interface AssetDetail extends Asset {
  upstream: Derivation[];
  downstream: Derivation[];
  file_url: string | null;
}

export const ZONE_LABELS: Record<Zone, string> = {
  source: "源料区",
  master: "母版区",
  publish: "发布态",
};

export const STATUS_LABELS: Record<Status, string> = {
  topic: "选题",
  drafting: "创作中",
  finalized: "定稿",
  publishing: "发布中",
  published: "已发布",
};
```

`frontend/src/api.ts`：

```typescript
import type { Asset, AssetDetail } from "./types";

const base = "/api";

export async function listAssets(params: {
  zone?: string; status?: string; q?: string;
}): Promise<Asset[]> {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v) as [string, string][]
  );
  const resp = await fetch(`${base}/assets?${qs}`);
  if (!resp.ok) throw new Error(`列表失败 ${resp.status}`);
  return resp.json();
}

export async function getAsset(id: string): Promise<AssetDetail> {
  const resp = await fetch(`${base}/assets/${id}`);
  if (!resp.ok) throw new Error(`详情失败 ${resp.status}`);
  return resp.json();
}

export async function uploadAsset(
  zone: string, title: string, file: File
): Promise<Asset> {
  const form = new FormData();
  form.append("zone", zone);
  form.append("title", title);
  form.append("file", file);
  const resp = await fetch(`${base}/assets`, { method: "POST", body: form });
  if (!resp.ok) throw new Error((await resp.json()).detail ?? "上传失败");
  return resp.json();
}

export async function patchStatus(id: string, status: string): Promise<Asset> {
  const resp = await fetch(`${base}/assets/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!resp.ok) throw new Error((await resp.json()).detail ?? "状态更新失败");
  return resp.json();
}

export async function derive(
  masterId: string, title: string, platform: string, file: File
): Promise<AssetDetail> {
  const form = new FormData();
  form.append("title", title);
  form.append("platform", platform);
  form.append("file", file);
  const resp = await fetch(`${base}/assets/${masterId}/derive`, {
    method: "POST", body: form,
  });
  if (!resp.ok) throw new Error((await resp.json()).detail ?? "派生失败");
  return resp.json();
}

export async function linkDerivation(
  derivedId: string, sourceAssetId: string
): Promise<void> {
  const resp = await fetch(`${base}/assets/${derivedId}/derivations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_asset_id: sourceAssetId }),
  });
  if (!resp.ok && resp.status !== 409)
    throw new Error((await resp.json()).detail ?? "补链失败");
}

export async function deleteAsset(id: string): Promise<void> {
  const resp = await fetch(`${base}/assets/${id}`, { method: "DELETE" });
  if (!resp.ok) throw new Error("删除失败");
}
```

`frontend/src/App.tsx`（替换脚手架内容，`index.css` 保留脚手架默认或清空均可）：

```tsx
import { useCallback, useEffect, useState } from "react";
import {
  deleteAsset, derive, getAsset, linkDerivation, listAssets, patchStatus, uploadAsset,
} from "./api";
import {
  STATUS_LABELS, TRANSITIONS, ZONE_LABELS, type Asset, type AssetDetail, type Zone,
} from "./types";

const ZONES: Zone[] = ["source", "master", "publish"];

export default function App() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [zone, setZone] = useState<string>("");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [error, setError] = useState("");

  // 上传表单
  const [upZone, setUpZone] = useState<string>("master");
  const [upTitle, setUpTitle] = useState("");
  const [upFile, setUpFile] = useState<File | null>(null);
  // 派生表单
  const [dvTitle, setDvTitle] = useState("");
  const [dvPlatform, setDvPlatform] = useState("微信公众号");
  const [dvFile, setDvFile] = useState<File | null>(null);
  // 补链表单
  const [linkSource, setLinkSource] = useState("");

  const refresh = useCallback(async () => {
    try {
      setAssets(await listAssets({ zone, q }));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, [zone, q]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!detail) return;
    void getAsset(detail.id).then(setDetail).catch(() => setDetail(null));
  }, [assets]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
      <h1>ContentHub · 资产底座</h1>
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <section style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <select value={zone} onChange={(e) => setZone(e.target.value)}>
          <option value="">全部区域</option>
          {ZONES.map((z) => <option key={z} value={z}>{ZONE_LABELS[z]}</option>)}
        </select>
        <input placeholder="搜索标题/正文…" value={q}
               onChange={(e) => setQ(e.target.value)} />
        <button onClick={() => void refresh()}>搜索</button>
      </section>

      <section style={{ border: "1px solid #ccc", padding: 12, marginBottom: 12 }}>
        <h2>上传资产</h2>
        <select value={upZone} onChange={(e) => setUpZone(e.target.value)}>
          <option value="source">源料区</option>
          <option value="master">母版区</option>
        </select>
        <input placeholder="标题" value={upTitle} onChange={(e) => setUpTitle(e.target.value)} />
        <input type="file" onChange={(e) => setUpFile(e.target.files?.[0] ?? null)} />
        <button onClick={async () => {
          if (!upFile || !upTitle) return;
          await uploadAsset(upZone, upTitle, upFile);
          setUpTitle(""); setUpFile(null); void refresh();
        }}>上传</button>
      </section>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th align="left">标题</th><th align="left">区域</th>
            <th align="left">状态</th><th align="left">更新时间</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.id} onClick={() => void getAsset(a.id).then(setDetail)}
                style={{ cursor: "pointer", borderTop: "1px solid #eee" }}>
              <td>{a.title}</td>
              <td>{ZONE_LABELS[a.zone]}</td>
              <td>{STATUS_LABELS[a.status]}</td>
              <td>{a.updated_at.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail && (
        <section style={{ border: "1px solid #369", padding: 12, marginTop: 16 }}>
          <h2>{detail.title}</h2>
          <p>
            {ZONE_LABELS[detail.zone]} · {STATUS_LABELS[detail.status]} · {detail.content_type}
            {detail.source_url && <> · <a href={detail.source_url}>源链接</a></>}
            {detail.file_url && <> · <a href={detail.file_url}>文件</a></>}
          </p>

          <div>
            状态流转：
            {TRANSITIONS[detail.status].map((s) => (
              <button key={s} onClick={async () => {
                await patchStatus(detail.id, s);
                setDetail(await getAsset(detail.id)); void refresh();
              }}>{STATUS_LABELS[s]}</button>
            ))}
          </div>

          {detail.zone === "master" && (
            <div style={{ marginTop: 8 }}>
              <h3>派生发布物</h3>
              <select value={dvPlatform} onChange={(e) => setDvPlatform(e.target.value)}>
                {["微信公众号", "抖音", "微信视频号", "哔哩哔哩", "官网"].map((p) =>
                  <option key={p}>{p}</option>)}
              </select>
              <input placeholder="发布物标题" value={dvTitle}
                     onChange={(e) => setDvTitle(e.target.value)} />
              <input type="file" onChange={(e) => setDvFile(e.target.files?.[0] ?? null)} />
              <button onClick={async () => {
                if (!dvFile || !dvTitle) return;
                await derive(detail.id, dvTitle, dvPlatform, dvFile);
                setDvTitle(""); setDvFile(null);
                setDetail(await getAsset(detail.id)); void refresh();
              }}>派生</button>
            </div>
          )}

          <div style={{ marginTop: 8 }}>
            <h3>血缘</h3>
            <p>上游：{detail.upstream.map((d) => d.source_asset_id).join("、") || "无"}</p>
            <p>下游：{detail.downstream.map((d) => d.derived_asset_id).join("、") || "无"}</p>
            <input placeholder="补链：上游资产 UUID" value={linkSource}
                   onChange={(e) => setLinkSource(e.target.value)} />
            <button onClick={async () => {
              await linkDerivation(detail.id, linkSource);
              setLinkSource(""); setDetail(await getAsset(detail.id));
            }}>补链</button>
          </div>

          <button style={{ marginTop: 8 }} onClick={async () => {
            await deleteAsset(detail.id); setDetail(null); void refresh();
          }}>删除资产</button>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 3: 本地构建验证**

```bash
cd frontend && npm run build
```

预期：`vite build` 成功，`tsc -b` 无类型错误。

- [ ] **Step 4: Docker 化（nginx 反代 /api）**

`frontend/Dockerfile`：

```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-slim
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

`frontend/nginx.conf`：

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://api:8000;
    }
}
```

- [ ] **Step 5: 全栈起冒烟**

```bash
make up && sleep 8 && curl -s http://localhost:8000/api/health
```

预期：`{"status":"ok","version":"0.1.0"}`；浏览器打开 `http://localhost:8080` 列表页可加载（此时库为空，上传一个 md 文件验证全链路：出现在列表 → 点开详情 → 状态流转按钮可用）。

- [ ] **Step 6: 提交**

```bash
git add frontend
git commit -m "feat: M0 前端最小界面（列表/搜索/上传/状态/派生/血缘/删除）"
```

---

### Task 8: 真实数据导入 + M0 验收 + 文档同步

**Files:**
- Modify: `README.md`（快速开始）
- Modify: `docs/product/PRD-MVP-001-mvp-build-plan.md`（M0 验收标记，按 FND-GOV-001 §7 绑定 commit 证据）

**Interfaces:**
- Consumes: 全部前序任务
- Produces: 真实数据入库；PRD M0 验收记录；对外快速开始文档

- [ ] **Step 1: 真实库 dry-run**

```bash
make dev
cd backend && .venv/bin/python -m app.importer.obsidian --vault "/Users/zhoudabo/Obsidian/【008】个人文章" --dry-run
```

预期：逐行打印 `[dry-run] zone:status 相对路径`；确认目录映射覆盖 6 个目录、无意外缺失（`主题索引.md` 在根目录不在映射内，属预期排除——如需入库再议）。

- [ ] **Step 2: 正式导入 + 重复报告**

```bash
.venv/bin/python -m app.importer.obsidian --vault "/Users/zhoudabo/Obsidian/【008】个人文章" --report dup-report.json
curl -s "http://localhost:8000/api/assets?limit=1" | python3 -c "import sys,json; print(len(json.loads(open('/dev/stdin').read())))" || true
```

验收命令（计数与抽查）：

```bash
curl -s "http://localhost:8000/api/assets?limit=200" | .venv/bin/python -c "import sys,json; a=json.load(sys.stdin); print('总数', len(a)); print('母版', sum(1 for x in a if x['zone']=='master')); print('源料', sum(1 for x in a if x['zone']=='source'))"
curl -s "http://localhost:8000/api/assets?q=跨品牌售后&limit=10" | .venv/bin/python -m json.tool | head -20
```

预期：总数 ≈ 122+（md+图片，不含根目录 `主题索引.md`）；`q=跨品牌售后` 命中多篇。

- [ ] **Step 3: 同题副本 → 母版+派生关系（验收标准 2）**

依据 `backend/dup-report.json` 挑一组（如"跨品牌售后"组），用其中定稿价值最高者作母版、口播稿作派生补链：

```bash
MASTER_ID="<报告组中拟作母版的 id>"
DERIVED_ID="<同组口播稿 id>"
curl -s -X POST "http://localhost:8000/api/assets/$DERIVED_ID/derivations" \
  -H "Content-Type: application/json" \
  -d "{\"source_asset_id\": \"$MASTER_ID\", \"note\": \"同题副本收敛：口播稿源于母版\"}"
curl -s "http://localhost:8000/api/assets/$DERIVED_ID" | .venv/bin/python -m json.tool | grep -A3 upstream
```

预期：`upstream` 出现母版 id。

- [ ] **Step 4: 唯一事实源验证（验收标准 3）**

任选资产：`PATCH status` 成功转 `finalized`，再 422 转 `published`（须先 publishing）——状态只由 API 改写、目录不再承载状态语义。

- [ ] **Step 5: README 快速开始 + PRD 验收标记**

`README.md` 在"快速开始（文档规范）"前插入：

```markdown
## 快速开始（应用）

```bash
make up                 # postgres + minio + api + frontend
open http://localhost:8080
# 导入既有 Obsidian 内容库
make import VAULT="/path/to/【008】个人文章"
```

开发：`make dev`（仅起 postgres/minio）→ `cd backend && .venv/bin/pytest -v`。
```

`docs/product/PRD-MVP-001-mvp-build-plan.md` §2 的 M0 行追加完成标记（commit hash 以实际为准，示例格式）：

```markdown
| M0 资产底座 | ✅ 已完成 \| commit: <7位hash> · 2026-09-XX（122 篇入库、同题副本以母版+派生收敛、状态唯一事实源） |
```

注意：docstd pre-commit 会校验 docs 改动——PRD 已是合规编号文档，正常通过。

- [ ] **Step 6: 提交**

```bash
git add README.md docs/product/PRD-MVP-001-mvp-build-plan.md
git commit -m "docs: M0 验收通过并绑定证据 (PRD-MVP-001)"
```

---

## Self-Review 记录

- **Spec 覆盖**：PRD §5 M0 五项——三区存储（T2/T3/T4）、状态机（T2/T4）、全文检索（T2 trgm 索引 + T4 `?q=`）、批量导入（T6）、协作原语字段（T2 模型）；验收三条对应 T8 Step 2/3/4。§6 交付形态（compose 自托管 + Web）→ T1/T7。§7 红线未引入任何违禁组件。✔
- **占位符扫描**：无 TBD/TODO；所有代码块完整可粘贴。✔
- **类型一致性**：`get_storage`/`get_db` 依赖名、`AssetOut/AssetDetail/DerivationOut` 字段、`presigned_get(zone, key)` 签名、`import_vault(vault, db, storage, ...)` 参数序在前端/导入器/路由间一致复核。✔
- **已知取舍**（非缺陷，记录在案）：① 详情血缘为直接上下游，递归祖先查询留待影响面分析需求出现时再做；② 检索为 ILIKE 子串 + trgm 索引，无相关性排序（M0 单人规模够用）；③ 前端为极简单页，组件库引入留 M1；④ 导入器对根目录散落文件（主题索引.md）不处理。
