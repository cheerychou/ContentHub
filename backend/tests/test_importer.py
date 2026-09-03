from pathlib import Path

from app.importer.obsidian import DEFAULT_MAP, duplicate_report, import_vault
from app.models import Asset, AssetStatus, AssetZone
from app.storage import FakeStorage


def _make_vault(root: Path):
    plan = root / "选题策划"
    draft = root / "公众号文章草稿"
    final = root / "定稿发表"
    for d in (plan, draft, final, root / "读书笔记", root / "八字分析", root / "个人"):
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
    assert len(all_ids & {
        str(a.id) for a in db_session.query(Asset).filter(Asset.source_path.like("公众号文章草稿/2026年%售后%"))
    }) >= 2
