"""一次性数据修复：把 zone='topic' 资产的对象从 source 桶迁到 topic 桶。

背景（评审修复）：storage.ZONES 最初未含 topic，选题导入把对象落进了
contenthub-source 桶，导致 GET 详情 presigned_get、孤儿清理等按 topic 桶寻址失败。
本脚本逐条把 object_key 从 source 桶 copy_object 到 topic 桶（同 key），head 校验
存在且 size 一致后才算成功；--apply 模式仅在校验通过后删除源桶副本。
dry-run 为默认，只报告不改动。

用法（在 backend/ 目录下）：
    .venv/bin/python -m scripts.migrate_topic_objects            # dry-run（默认）
    .venv/bin/python -m scripts.migrate_topic_objects --apply    # 复制+校验+删源
"""
import argparse
import sys

from minio.commonconfig import CopySource
from minio.error import S3Error
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Asset, AssetZone
from app.storage import MinioStorage, get_storage


def _stat(client, bucket: str, key: str):
    """返回对象统计，不存在返回 None（其余 S3Error 上抛）。"""
    try:
        return client.stat_object(bucket, key)
    except S3Error as exc:
        if exc.code in ("NoSuchKey", "NoSuchObject"):
            return None
        raise


def migrate(storage: MinioStorage, db, *, apply: bool) -> int:
    """迁移全部 zone=topic 且有 object_key 的资产对象，返回失败条数。"""
    src_bucket, dst_bucket = storage.buckets["source"], storage.buckets["topic"]
    assets = db.scalars(
        select(Asset).where(
            Asset.zone == AssetZone.TOPIC, Asset.object_key.is_not(None)
        )
    ).all()
    print(f"待迁移 topic 资产 {len(assets)} 条（{'apply' if apply else 'dry-run'}）")
    print(f"{src_bucket} -> {dst_bucket}")

    failures = 0
    verified: list[str] = []  # copy+head 校验通过、可删源的对象 key
    for asset in assets:
        key = asset.object_key
        try:
            src = _stat(storage.client, src_bucket, key)
            if src is None:
                print(f"  [跳过] 源缺失 {src_bucket}/{key}（可能已迁移）")
                continue
            dst = _stat(storage.client, dst_bucket, key)
            if dst is not None and dst.size == src.size:
                print(f"  [已存在] 目标已就位 {dst_bucket}/{key}（size={dst.size}）")
                verified.append(key)
                continue
            if not apply:
                print(f"  [将迁移] {key}（size={src.size}）")
                continue
            storage.client.copy_object(
                dst_bucket, key, CopySource(src_bucket, key)
            )
            dst = _stat(storage.client, dst_bucket, key)
            if dst is None or dst.size != src.size:
                raise RuntimeError(
                    f"目标校验失败 {dst_bucket}/{key}: dst={dst and dst.size} "
                    f"src={src.size}"
                )
            print(f"  [{'已迁移' if apply else '将迁移'}] {key}（size={src.size}）")
            verified.append(key)
        except Exception as exc:  # noqa: BLE001 - 单条失败不中断整体迁移
            failures += 1
            print(f"  [失败] {key}: {exc}")

    if apply and verified:
        print(f"删除源桶副本 {len(verified)} 个（仅校验通过者）")
        for key in verified:
            storage.client.remove_object(src_bucket, key)

    mode = "apply" if apply else "dry-run"
    print(f"完成：{len(verified)} 条就绪，{failures} 条失败（{mode}）。")
    return failures


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m scripts.migrate_topic_objects",
        description="把 zone=topic 资产对象从 source 桶迁移到 topic 桶",
    )
    parser.add_argument("--apply", action="store_true",
                        help="执行迁移并删除源桶副本（默认 dry-run）")
    args = parser.parse_args(argv)

    storage = get_storage()
    if not isinstance(storage, MinioStorage):
        print("错误：需要真实 MinioStorage（请勿在 FakeStorage 环境下运行）", file=sys.stderr)
        return 2

    db = SessionLocal()
    try:
        return 1 if migrate(storage, db, apply=args.apply) else 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
