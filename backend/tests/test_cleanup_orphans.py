"""孤儿对象清理：storage 中存在但无任何 assets.object_key 引用的对象。

真实 MinIO 模式同 M0 storage 注入——这里用 FakeStorage 双实现覆盖清理逻辑，
MinioStorage.list_keys 的适配在 test_storage.py 用桩 client 验证。
"""
import pytest

from app.models import Asset, AssetStatus, AssetZone
from app.storage import FakeStorage
from scripts.cleanup_orphans import find_orphans, main


@pytest.fixture()
def seeded(db_session):
    """三个区各一个被引用对象 + source/publish 各一个孤儿（无资产引用）。"""
    db_session.add_all([
        Asset(zone=AssetZone.SOURCE, status=AssetStatus.AVAILABLE,
              title="源料", content_type="markdown", object_key="src-uuid/a.md"),
        Asset(zone=AssetZone.MASTER, status=AssetStatus.DRAFTING,
              title="母版", content_type="video", object_key="mst-uuid/master.mov"),
        Asset(zone=AssetZone.PUBLISH, status=AssetStatus.PUBLISHING,
              title="发布", content_type="image", object_key="pub-uuid/cover.png"),
    ])
    db_session.flush()

    storage = FakeStorage()
    storage.put("source", "src-uuid/a.md", b"md", "text/markdown")
    storage.put("master", "mst-uuid/master.mov", b"mov", "video/quicktime")
    storage.put("publish", "pub-uuid/cover.png", b"png", "image/png")
    # 孤儿：上传中断 / 删除资产未回收等留下的无主对象
    storage.put("source", "deadbeef/lost.md", b"x", "text/markdown")
    storage.put("publish", "deadbeef/orphan.png", b"x", "image/png")
    return storage


def test_find_orphans_lists_only_unreferenced(seeded, db_session):
    assert find_orphans(seeded, db_session) == {
        "source": ["deadbeef/lost.md"],
        "master": [],
        "publish": ["deadbeef/orphan.png"],
    }


def test_dry_run_lists_orphans_and_keeps_them(seeded, db_session, capsys):
    rc = main([], storage=seeded, db=db_session)
    assert rc == 0
    out = capsys.readouterr().out
    assert "deadbeef/lost.md" in out
    assert "deadbeef/orphan.png" in out
    assert "dry-run" in out
    # 默认不删除
    assert ("source", "deadbeef/lost.md") in seeded.objects
    assert ("publish", "deadbeef/orphan.png") in seeded.objects


def test_delete_removes_orphans_keeps_referenced(seeded, db_session, capsys):
    rc = main(["--delete"], storage=seeded, db=db_session)
    assert rc == 0
    assert ("source", "deadbeef/lost.md") not in seeded.objects
    assert ("publish", "deadbeef/orphan.png") not in seeded.objects
    # 被引用对象必须原样保留
    assert ("source", "src-uuid/a.md") in seeded.objects
    assert ("master", "mst-uuid/master.mov") in seeded.objects
    assert ("publish", "pub-uuid/cover.png") in seeded.objects
    out = capsys.readouterr().out
    assert "已删除" in out


def test_explicit_dry_run_flag_never_deletes(seeded, db_session):
    rc = main(["--dry-run"], storage=seeded, db=db_session)
    assert rc == 0
    assert ("publish", "deadbeef/orphan.png") in seeded.objects
