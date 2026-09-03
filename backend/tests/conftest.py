import pytest
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from app.db import Base, engine


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
