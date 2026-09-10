"""存量资产属性回填：为 M7 之前上传的资产补齐 meta.attrs。

候选：content_type ∈ image/video/audio 且有 object_key（从存储取字节，
视频/音频走真实 ffprobe——运行环境需安装 ffmpeg），或 content_type ∈
markdown/docx 且有正文（抽字数与语言）。抽取结果深合并入 meta.attrs：
已有 attrs 的资产跳过；--force 强制重抽（重抽键覆盖旧自动键，
人工独有键保留，同 PATCH 补录语义的镜像）。dry-run 为默认，防误写。

单资产抽取/读取失败只计失败并继续（失败隔离，同上传链路）。

用法（在 backend/ 目录下）：
    .venv/bin/python -m scripts.backfill_attrs                  # dry-run（默认）
    .venv/bin/python -m scripts.backfill_attrs --dry-run        # 显式 dry-run
    .venv/bin/python -m scripts.backfill_attrs --apply          # 写回 meta.attrs
    .venv/bin/python -m scripts.backfill_attrs --apply --force  # 已有 attrs 也重抽
"""
import argparse
import sys

from sqlalchemy import or_, select

from app.db import SessionLocal
from app.media_attrs import extract_attrs, merge_attrs
from app.models import Asset
from app.storage import ObjectStorage, get_storage

FILE_TYPES = ("image", "video", "audio")
TEXT_TYPES = ("markdown", "docx")


def iter_targets(db) -> list[Asset]:
    """回填候选：有对象键的文件素材，或有正文的文本素材；按创建时间稳定排序。"""
    stmt = select(Asset).where(or_(
        Asset.content_type.in_(FILE_TYPES) & Asset.object_key.isnot(None),
        Asset.content_type.in_(TEXT_TYPES)
        & Asset.text_content.isnot(None)
        & (Asset.text_content != ""),
    )).order_by(Asset.created_at, Asset.id)
    return list(db.scalars(stmt))


def extract_for(asset: Asset, storage: ObjectStorage) -> dict:
    """按资产类型抽取属性，分派规则与 assets.store_upload 一致。"""
    if asset.content_type in FILE_TYPES and asset.object_key:
        data = storage.get_bytes(asset.zone.value, asset.object_key)
        return extract_attrs(asset.content_type, data=data)
    if asset.content_type in TEXT_TYPES and asset.text_content:
        return extract_attrs(asset.content_type, text=asset.text_content)
    return {}


def main(argv=None, *, storage: ObjectStorage | None = None, db=None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m scripts.backfill_attrs",
        description="为存量资产回填素材属性（meta.attrs）",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true",
                      help="仅报告，不写入（默认行为）")
    mode.add_argument("--apply", action="store_true", help="写回 meta.attrs")
    parser.add_argument("--force", action="store_true",
                        help="已有 attrs 也重新抽取（自动键覆盖旧值，人工键保留）")
    args = parser.parse_args(argv)

    own_db = db is None
    if db is None:
        db = SessionLocal()
    if storage is None:
        storage = get_storage()

    counts = {"filled": 0, "skipped": 0, "empty": 0, "error": 0}
    try:
        targets = iter_targets(db)
        for asset in targets:
            label = (f"[{asset.content_type}] {asset.zone.value}/"
                     f"{asset.id} {asset.title}")
            if (asset.meta or {}).get("attrs") and not args.force:
                counts["skipped"] += 1
                print(f"跳过（已有 attrs）：{label}")
                continue
            try:
                attrs = extract_for(asset, storage)
            except Exception as exc:  # noqa: BLE001 - 单资产失败不阻塞整批
                counts["error"] += 1
                print(f"失败（{type(exc).__name__}: {exc}）：{label}")
                continue
            if not attrs:
                counts["empty"] += 1
                print(f"空结果（未抽取到属性）：{label}")
                continue
            existing = dict((asset.meta or {}).get("attrs") or {})
            merged = merge_attrs(existing, attrs) if existing else attrs
            counts["filled"] += 1
            print(f"{'回填' if args.apply else '拟回填'}：{label} → {merged}")
            if args.apply:
                asset.meta = {**(asset.meta or {}), "attrs": merged}
        if args.apply:
            db.commit()
        action = ("已写回 meta.attrs" if args.apply
                  else "dry-run（未写入；加 --apply 写入）")
        print(f"共 {len(targets)} 个候选：回填 {counts['filled']}，"
              f"跳过 {counts['skipped']}（已有 attrs），"
              f"空结果 {counts['empty']}，失败 {counts['error']}。{action}")
        return 0
    finally:
        if own_db:
            db.close()


if __name__ == "__main__":
    sys.exit(main())
