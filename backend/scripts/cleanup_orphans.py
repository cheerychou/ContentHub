"""孤儿对象清理：列出/删除对象存储中无任何 assets.object_key 引用的对象。

逐区（source/master/publish）对比 storage 实际 key 与资产表引用，
差集即孤儿（上传中断、删除资产未回收等残留）。dry-run 为默认，防误删。

用法（在 backend/ 目录下）：
    .venv/bin/python -m scripts.cleanup_orphans             # dry-run（默认）
    .venv/bin/python -m scripts.cleanup_orphans --dry-run   # 显式 dry-run
    .venv/bin/python -m scripts.cleanup_orphans --delete    # 真删
"""
import argparse
import sys

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Asset
from app.storage import ZONES, ObjectStorage, get_storage


def find_orphans(storage: ObjectStorage, db) -> dict[str, list[str]]:
    """返回 {zone: [孤儿 key,...]}；key 排序保证输出/删除顺序稳定。"""
    referenced: dict[str, set[str]] = {zone: set() for zone in ZONES}
    for zone, key in db.execute(select(Asset.zone, Asset.object_key)).all():
        if key:
            referenced[zone.value].add(key)
    return {
        zone: sorted(set(storage.list_keys(zone)) - referenced[zone])
        for zone in ZONES
    }


def main(argv=None, *, storage: ObjectStorage | None = None, db=None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m scripts.cleanup_orphans",
        description="清理对象存储中未被任何资产引用的孤儿对象",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true",
                      help="仅列出，不删除（默认行为）")
    mode.add_argument("--delete", action="store_true", help="删除孤儿对象")
    args = parser.parse_args(argv)

    own_db = db is None
    if db is None:
        db = SessionLocal()
    if storage is None:
        storage = get_storage()

    try:
        orphans = find_orphans(storage, db)
        total = sum(len(keys) for keys in orphans.values())
        for zone in ZONES:
            keys = orphans[zone]
            print(f"[{zone}] 孤儿对象 {len(keys)} 个")
            for key in keys:
                print(f"  {zone}/{key}")
                if args.delete:
                    storage.delete(zone, key)
        action = "已删除" if args.delete else "dry-run（未删除；加 --delete 真删）"
        print(f"共 {total} 个孤儿对象，{action}。")
        return 0
    finally:
        if own_db:
            db.close()


if __name__ == "__main__":
    sys.exit(main())
