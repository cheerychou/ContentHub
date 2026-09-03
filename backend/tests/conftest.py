import os
import re

import psycopg
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.db import Base

TEST_DB_NAME = "contenthub_test"


def _test_database_url() -> str:
    """测试库 URL：取 settings.database_url 仅替换末段库名；可用 CH_TEST_DATABASE_URL 覆盖。"""
    override = os.environ.get("CH_TEST_DATABASE_URL")
    if override:
        return override
    # 仅替换 URL 最后一个路径段（库名），保留协议/凭据/主机/端口/查询参数
    return re.sub(r"/[^/?]*(\?[^/]*)?$", f"/{TEST_DB_NAME}\\1", settings.database_url)


TEST_URL = _test_database_url()
_test_url = make_url(TEST_URL)
if _test_url.database != TEST_DB_NAME:
    raise RuntimeError(
        f"测试库 URL 必须指向 {TEST_DB_NAME!r}，当前为 {_test_url.database!r}"
        f"（{TEST_URL}）：拒绝在非测试库上执行 drop/truncate"
    )


def _ensure_test_database(url) -> None:
    """确保 contenthub_test 存在（连维护库 postgres 幂等建库，绝不触碰开发库）。"""
    conn = psycopg.connect(
        host=url.host,
        port=url.port or 5432,
        user=url.username,
        password=url.password,
        dbname="postgres",
        autocommit=True,
    )
    try:
        exists = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (TEST_DB_NAME,)
        ).fetchone()
        if not exists:
            try:
                conn.execute(f'CREATE DATABASE "{TEST_DB_NAME}"')
            except psycopg.errors.DuplicateDatabase:
                pass  # 并发竞态：别的会话刚建好
    finally:
        conn.close()


_ensure_test_database(_test_url)
engine = create_engine(TEST_URL, pool_pre_ping=True)


@pytest.fixture(scope="session", autouse=True)
def _schema():
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture()
def db_session():
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    db = factory()
    yield db
    db.rollback()
    db.execute(text("TRUNCATE assets, derivations CASCADE"))
    db.commit()
    db.close()
