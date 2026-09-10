"""存量资产属性回填：dry-run 只报告；--apply 写 meta.attrs；--force 重抽合并。

FakeStorage 双实现（同 cleanup_orphans），PNG 用真字节（1×1 红点，
同 test_media_attrs / test_assets_api）。候选规则与抽取分派见脚本 docstring。
"""
import base64

import pytest

from app.models import Asset, AssetStatus, AssetZone
from app.storage import FakeStorage
from scripts.backfill_attrs import iter_targets, main

PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1Pe"
    "AAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
)

MD_TEXT = "# 标题\n\n途虎养车供应链视角。"
IMG_KEY = "img-uuid/cover.png"


@pytest.fixture()
def seeded(db_session):
    """一个 PNG 对象 + 一个 md 正文资产（候选），一个外链资产（不候选）。"""
    db_session.add_all([
        Asset(zone=AssetZone.SOURCE, status=AssetStatus.AVAILABLE,
              title="封面图", content_type="image", object_key=IMG_KEY),
        Asset(zone=AssetZone.MASTER, status=AssetStatus.DRAFTING,
              title="文稿", content_type="markdown", text_content=MD_TEXT),
        Asset(zone=AssetZone.SOURCE, status=AssetStatus.AVAILABLE,
              title="外链", content_type="link",
              source_url="https://example.com/post"),
    ])
    db_session.flush()
    storage = FakeStorage()
    storage.put("source", IMG_KEY, PNG_1X1, "image/png")
    return storage


def _by_title(db_session) -> dict[str, Asset]:
    return {a.title: a for a in db_session.query(Asset).all()}


def test_iter_targets_picks_file_and_text_assets(seeded, db_session):
    types = sorted(a.content_type for a in iter_targets(db_session))
    assert types == ["image", "markdown"]  # link 等无源类型不入选


def test_dry_run_reports_without_writing(seeded, db_session, capsys):
    rc = main(["--dry-run"], storage=seeded, db=db_session)
    assert rc == 0
    out = capsys.readouterr().out
    assert "dry-run" in out
    assert "拟回填" in out
    for asset in db_session.query(Asset).all():
        assert "attrs" not in (asset.meta or {})  # 默认绝不写入


def test_apply_fills_attrs_for_file_and_text(seeded, db_session, capsys):
    rc = main(["--apply"], storage=seeded, db=db_session)
    assert rc == 0
    by_title = _by_title(db_session)
    assert by_title["封面图"].meta["attrs"] == {
        "format": "PNG", "width": 1, "height": 1}
    md_attrs = by_title["文稿"].meta["attrs"]
    assert md_attrs["word_count"] > 0
    assert md_attrs["language"] == "zh"
    out = capsys.readouterr().out
    assert "已写回" in out
    assert "回填 2" in out


def test_second_run_is_idempotent_skip(seeded, db_session, capsys):
    assert main(["--apply"], storage=seeded, db=db_session) == 0
    first = {t: dict(a.meta.get("attrs") or {})
             for t, a in _by_title(db_session).items()}
    capsys.readouterr()
    rc = main(["--apply"], storage=seeded, db=db_session)
    out = capsys.readouterr().out
    assert rc == 0
    assert "跳过 2" in out  # 已有 attrs 一律跳过
    second = {t: dict(a.meta.get("attrs") or {})
              for t, a in _by_title(db_session).items()}
    assert second == first  # 幂等：meta.attrs 原样保留


def test_force_reextracts_and_keeps_manual_keys(seeded, db_session, capsys):
    assert main(["--apply"], storage=seeded, db=db_session) == 0
    img = _by_title(db_session)["封面图"]
    img.meta = {**(img.meta or {}),
                "attrs": {**(img.meta.get("attrs") or {}), "author": "周大波",
                          "width": 999}}
    db_session.commit()
    capsys.readouterr()
    rc = main(["--apply", "--force"], storage=seeded, db=db_session)
    assert rc == 0
    attrs = img.meta["attrs"]
    assert attrs["author"] == "周大波"  # 人工独有键保留
    assert attrs["width"] == 1          # 自动键重抽覆盖旧值
    assert attrs["format"] == "PNG"
    assert "回填 2" in capsys.readouterr().out


def test_storage_failure_reports_error_writes_nothing(db_session, capsys):
    """存储对象缺失等单资产失败：计失败、不写 attrs、不阻塞整批。"""
    db_session.add(Asset(zone=AssetZone.SOURCE, status=AssetStatus.AVAILABLE,
                         title="丢图", content_type="image", object_key=IMG_KEY))
    db_session.flush()
    rc = main(["--apply"], storage=FakeStorage(), db=db_session)  # 空存储
    assert rc == 0
    out = capsys.readouterr().out
    assert "失败" in out
    asset = db_session.query(Asset).one()
    assert "attrs" not in (asset.meta or {})
    assert "失败 1" in out
