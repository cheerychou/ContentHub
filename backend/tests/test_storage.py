import io

import pytest

from app.storage import FakeStorage


def test_fake_storage_roundtrip():
    s = FakeStorage()
    s.ensure_buckets()
    s.put("master", "abc/cover.png", b"pngbytes", "image/png")
    assert s.get("master", "abc/cover.png") == b"pngbytes"
    assert s.presigned_get("master", "abc/cover.png").startswith("fake://")
    s.delete("master", "abc/cover.png")
    assert s.get("master", "abc/cover.png") is None


def test_fake_storage_put_stream_length_mismatch_raises():
    s = FakeStorage()
    with pytest.raises(ValueError):
        s.put_stream("master", "a/b.mov", io.BytesIO(b"short"),
                     length=10, content_type="video/quicktime")
    assert s.get("master", "a/b.mov") is None


def test_fake_storage_put_stream_matching_length():
    s = FakeStorage()
    payload = b"x" * 8
    s.put_stream("master", "a/b.mov", io.BytesIO(payload),
                 length=len(payload), content_type="video/quicktime")
    assert s.get("master", "a/b.mov") == payload
