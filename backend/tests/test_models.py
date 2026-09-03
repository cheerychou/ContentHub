import pytest

from app.models import (
    Asset,
    AssetStatus,
    AssetZone,
    Derivation,
    TRANSITIONS,
)


def test_transition_table_matches_prd():
    assert TRANSITIONS[AssetStatus.TOPIC] == {AssetStatus.DRAFTING}
    assert TRANSITIONS[AssetStatus.DRAFTING] == {AssetStatus.FINALIZED}
    assert TRANSITIONS[AssetStatus.FINALIZED] == {
        AssetStatus.DRAFTING,
        AssetStatus.PUBLISHING,
    }
    assert TRANSITIONS[AssetStatus.PUBLISHING] == {
        AssetStatus.FINALIZED,
        AssetStatus.PUBLISHED,
    }
    assert TRANSITIONS[AssetStatus.PUBLISHED] == set()


def test_asset_roundtrip(db_session):
    a = Asset(
        zone=AssetZone.MASTER,
        status=AssetStatus.DRAFTING,
        title="跨品牌售后：浪潮之下冷暖自知",
        content_type="markdown",
        text_content="168 元保养 299 元漆面",
    )
    db_session.add(a)
    db_session.flush()

    got = db_session.get(Asset, a.id)
    assert got.zone is AssetZone.MASTER
    assert got.status is AssetStatus.DRAFTING
    assert got.created_by == "zhoudabo"


def test_derivation_pair_unique(db_session):
    m = Asset(zone=AssetZone.MASTER, status=AssetStatus.FINALIZED, title="母版", content_type="markdown")
    p = Asset(zone=AssetZone.PUBLISH, status=AssetStatus.PUBLISHING, title="公众号版", content_type="markdown")
    db_session.add_all([m, p])
    db_session.flush()
    db_session.add(Derivation(source_asset_id=m.id, derived_asset_id=p.id))
    db_session.flush()
    db_session.add(Derivation(source_asset_id=m.id, derived_asset_id=p.id))
    with pytest.raises(Exception):
        db_session.flush()
