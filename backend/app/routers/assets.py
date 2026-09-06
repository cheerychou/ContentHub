import io
import json
import shutil
import tempfile
import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..cover_specs import COVER_SPECS, PLATFORM_GUIDES, base_platform, spec_for
from ..db import get_db
from ..models import (
    Asset,
    AssetStatus,
    AssetZone,
    Derivation,
    Recipe,
    RecipeKind,
    TRANSITIONS,
    utcnow,
)
from ..rendering import render_html
from .. import rendering
from .. import speech
from .. import subtitles
from .. import docx_text
from ..schemas import (
    AssetDetail,
    AssetExternalCreate,
    AssetOut,
    DerivationCreate,
    DerivationOut,
    DeriveTextCreate,
    PublishInfoUpdate,
    StatusUpdate,
)
from ..storage import get_storage
from .. import llm as llm_mod
from ..llm import LLMNotConfigured

router = APIRouter(prefix="/api/assets", tags=["assets"])

MAX_UPLOAD_BYTES = 2 * 1024**3  # 2GB（视频母版）
INLINE_TEXT_LIMIT = 50 * 1024**2  # 50MB 以下走内存并抽取文本

EXT_CONTENT_TYPE = {
    ".md": "markdown", ".markdown": "markdown",
    ".docx": "docx",
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


async def store_upload(storage, zone: AssetZone, key: str, file: UploadFile,
                       content_type: str) -> str | None:
    """小文件入内存并返回文本（markdown/docx）；大文件 spool 流式；超 2GB 拒绝。

    UploadFile 已在磁盘 spill：读头部判定大小，小文件进内存并抽文本，
    大文件 spool 流式上传。返回抽取的文本（markdown/docx），其余返回 None；
    超 2GB 抛 413（调用方须 rollback 后 re-raise）。

    小文件路径先抽取后落盘：docx 解析失败抛 422 时存储中不残留孤儿对象。
    """
    data = await file.read(INLINE_TEXT_LIMIT + 1)
    if len(data) <= INLINE_TEXT_LIMIT:
        text: str | None = None
        if content_type == "markdown":
            text = data.decode("utf-8", errors="ignore")  # 永不抛错
        elif content_type == "docx":
            try:
                text = docx_text.extract_text(data)
            except Exception as exc:  # noqa: BLE001 - python-docx 异常类型不稳定
                raise HTTPException(
                    422, "docx 解析失败：文件可能已损坏或非有效 Word 文档") from exc
        storage.put(zone, key, data, file.content_type or "application/octet-stream")
        return text
    with tempfile.SpooledTemporaryFile(max_size=64 * 1024 * 1024) as tmp:
        tmp.write(data)
        shutil.copyfileobj(file.file, tmp)
        size = tmp.tell()
        if size > MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"文件超过上限 {MAX_UPLOAD_BYTES} 字节")
        tmp.seek(0)
        storage.put_stream(zone, key, tmp, size,
                           file.content_type or "application/octet-stream")
    return None


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
    try:
        asset.text_content = await store_upload(storage, zone, key, file, ct)
    except HTTPException:
        db.rollback()
        raise
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
    limit: int = Query(50, ge=0, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    stmt = select(Asset).order_by(Asset.updated_at.desc()).limit(limit).offset(offset)
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


@router.patch("/{asset_id}/publish-info", response_model=AssetOut)
def update_publish_info(asset_id: uuid.UUID, body: PublishInfoUpdate,
                        db: Session = Depends(get_db)):
    """发布登记：回填 published_url 并自动记录 published_at；状态不经由此端点管理。"""
    asset = get_asset_or_404(db, asset_id)
    if asset.zone != AssetZone.PUBLISH:
        raise HTTPException(
            422, f"仅发布态资产可登记发布信息，当前 zone={asset.zone.value}")
    if body.clear:
        asset.published_url = None
        asset.published_at = None
        db.commit()
        db.refresh(asset)
        return asset
    if asset.published_url:
        raise HTTPException(
            409, f"该资产已登记发布链接：{asset.published_url}；清空后可重新登记")
    if body.published_url is None:
        raise HTTPException(
            422, "缺少 published_url（或 clear=true）")
    asset.published_url = str(body.published_url)
    asset.published_at = utcnow()
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
    try:
        pub.text_content = await store_upload(
            storage, AssetZone.PUBLISH, key, file, ct)
    except HTTPException:
        db.rollback()
        raise
    pub.object_key = key

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
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "派生关系已存在")
    db.refresh(d)
    return d


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

    try:
        spec_dict = spec_for(platform, json.loads(spec) if spec else None)
    except (json.JSONDecodeError, ValueError, KeyError) as exc:
        raise HTTPException(
            422,
            f"spec 非法：需为 {{\"width\":..,\"height\":..}} JSON 或未知平台：{exc}",
        )
    image_bytes = storage.get_bytes(master.zone.value, master.object_key)

    try:
        with tempfile.TemporaryDirectory() as tmp:
            img_path = Path(tmp) / f"bg{Path(master.file_name or 'bg.png').suffix or '.png'}"
            img_path.write_bytes(image_bytes)
            html = render_html(recipe.content, {
                "width": spec_dict["width"], "height": spec_dict["height"],
                "title": title, "subtitle": subtitle,
                "image_file": str(img_path),
                "title_size": max(28, spec_dict["height"] // 12),
                "subtitle_size": max(18, spec_dict["height"] // 20),
                "padding": max(24, spec_dict["width"] // 18),
            })
            png = rendering.screenshot(html, spec_dict["width"], spec_dict["height"])
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - Playwright 异常类型不稳定
        raise HTTPException(503, f"渲染引擎不可用: {exc}")

    pub = Asset(zone=AssetZone.PUBLISH, status=AssetStatus.PUBLISHING,
                title=f"{platform}封面：{title}",
                file_name=f"cover-{base_platform(platform)}.png", content_type="image",
                created_by=master.created_by,
                meta={"platform": platform, "rendered": True,
                      "recipe_id": str(recipe_id), "spec": spec_dict,
                      "guide": PLATFORM_GUIDES.get(platform)})
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


@router.post("/{master_id}/derive-text", status_code=201, response_model=AssetDetail)
def derive_text_for_master(
    master_id: uuid.UUID,
    body: DeriveTextCreate,
    db: Session = Depends(get_db),
):
    master = get_asset_or_404(db, master_id)
    if not master.text_content:
        raise HTTPException(422, "母版缺少正文 text_content，无法派生文本变体")
    recipe = db.get(Recipe, body.recipe_id)
    if recipe is None or recipe.kind != RecipeKind.TEXT_PROMPT:
        raise HTTPException(404, "文本提示词配方不存在")

    system = recipe.content.replace("【母版正文】", master.text_content)
    for k, v in body.params.items():
        system = system.replace("{" + k + "}", v)
    user = master.text_content + "\n\n" + (body.instructions or "请开始")
    try:
        llm = llm_mod.get_llm()
        generated = llm.complete(system, user)
    except LLMNotConfigured as exc:
        raise HTTPException(503, str(exc))
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            502, f"LLM 上游返回 {exc.response.status_code}，文本变体生成失败")
    except httpx.TransportError as exc:
        raise HTTPException(502, f"LLM 服务不可达: {exc}")

    pub = Asset(zone=AssetZone.PUBLISH, status=AssetStatus.PUBLISHING,
                title=body.title, content_type="markdown",
                text_content=generated, created_by=master.created_by,
                meta={"generated": True, "recipe_id": str(body.recipe_id)})
    db.add(pub)
    db.flush()
    db.add(Derivation(source_asset_id=master.id, derived_asset_id=pub.id,
                      recipe_ref=str(body.recipe_id),
                      created_by=master.created_by))
    db.commit()
    db.refresh(pub)
    detail = AssetDetail.model_validate(pub)
    detail.upstream = [DerivationOut.model_validate(d) for d in pub.upstream]
    return detail


def _shotlist_md(title: str, voice: str, timed: list[dict]) -> str:
    """素材清单 markdown：逐句编号，留"建议画面"空位供人工填充。"""
    lines = [f"# 素材清单：{title}", "",
             f"- 音色：{voice}", f"- 句数：{len(timed)}", "", "## 分句画面", ""]
    lines += [f"- [{i:02d}] {x['text']} ｜ 建议画面：＿＿＿"
              for i, x in enumerate(timed, 1)]
    return "\n".join(lines) + "\n"


@router.post("/{master_id}/derive-video-kit", status_code=201,
             response_model=AssetDetail)
def derive_video_kit_for_master(
    master_id: uuid.UUID,
    voice: str = Form(speech.DEFAULT_VOICE_NAME),
    title: str | None = Form(None),
    db: Session = Depends(get_db),
    storage=Depends(get_storage),
):
    """语音包三件套：文本级切句 → TTS（词时间戳）→ SRT + 素材清单 + 音频 zip。"""
    master = get_asset_or_404(db, master_id)
    if not (master.text_content or "").strip():
        raise HTTPException(422, "母版正文为空，无法生成语音包")
    voice_value = speech.VOICES.get(voice)
    if voice_value is None:
        raise HTTPException(
            422, f"未知音色 {voice}；可选 {sorted(speech.VOICES)}")

    text = master.text_content
    sentences = subtitles.split_text(text)
    try:
        mp3, words = speech.synthesize_with_retry(text, voice_value)
    except Exception as exc:  # noqa: BLE001 - edge-tts/websockets 异常类型不稳定
        raise HTTPException(502, f"TTS 服务不可达: {exc}")
    timed = subtitles.align_timestamps(sentences, words)
    if not timed:
        raise HTTPException(502, "TTS 未返回有效词序列，无法生成字幕")
    srt = subtitles.to_srt(timed)
    kit_title = title or f"{master.title} 语音包"
    shotlist = _shotlist_md(kit_title, voice, timed)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("audio.mp3", mp3)
        zf.writestr("subtitle.srt", srt)
        zf.writestr("shotlist.md", shotlist)

    pub = Asset(zone=AssetZone.PUBLISH, status=AssetStatus.PUBLISHING,
                title=kit_title, file_name="video-kit.zip", content_type="archive",
                created_by=master.created_by,
                meta={"kind": "video_kit", "voice": voice,
                      "sentences": len(timed)})
    db.add(pub)
    db.flush()
    key = f"{pub.id}/video-kit.zip"
    storage.put(AssetZone.PUBLISH.value, key, buf.getvalue(), "application/zip")
    pub.object_key = key
    db.add(Derivation(source_asset_id=master.id, derived_asset_id=pub.id,
                      created_by=master.created_by))
    db.commit()
    db.refresh(pub)
    detail = AssetDetail.model_validate(pub)
    detail.upstream = [DerivationOut.model_validate(d) for d in pub.upstream]
    detail.file_url = storage.presigned_get(pub.zone.value, pub.object_key)
    return detail
