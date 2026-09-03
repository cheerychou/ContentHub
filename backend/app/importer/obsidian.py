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
    if "." not in name:
        return "other"
    suffix = "." + name.rsplit(".", 1)[-1].lower()
    return EXT_CONTENT_TYPE.get(suffix, "other")


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
