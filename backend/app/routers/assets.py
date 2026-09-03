import shutil
import tempfile
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Asset, AssetStatus, AssetZone, Derivation, TRANSITIONS
from ..schemas import (
    AssetDetail,
    AssetExternalCreate,
    AssetOut,
    DerivationCreate,
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
