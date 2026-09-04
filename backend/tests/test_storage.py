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


def test_fake_storage_get_bytes():
    s = FakeStorage()
    s.put("master", "k/x.png", b"img", "image/png")
    assert s.get_bytes("master", "k/x.png") == b"img"


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


def test_fake_storage_list_keys_filters_by_zone():
    s = FakeStorage()
    s.put("source", "u1/a.md", b"x", "text/markdown")
    s.put("master", "u2/b.mov", b"x", "video/quicktime")
    s.put("master", "u3/c.png", b"x", "image/png")
    assert sorted(s.list_keys("master")) == ["u2/b.mov", "u3/c.png"]
    assert s.list_keys("publish") == []


class _StubObject:
    def __init__(self, object_name: str):
        self.object_name = object_name


class _StubMinioClient:
    def __init__(self, names: list[str]):
        self._names = names
        self.buckets_seen: list[str] = []

    def list_objects(self, bucket: str, recursive: bool = False):
        assert recursive is True
        self.buckets_seen.append(bucket)
        return [_StubObject(n) for n in self._names]


def test_minio_storage_list_keys_maps_object_names():
    """list_keys 递归遍历对应桶并取 object_name（孤儿清理依赖此适配）。"""
    from app.storage import MinioStorage

    s = MinioStorage("localhost:9000", "k", "s", "ch-")
    stub = _StubMinioClient(["u2/b.mov", "u3/c.png"])
    s.client = stub
    assert s.list_keys("master") == ["u2/b.mov", "u3/c.png"]
    assert stub.buckets_seen == ["ch-master"]
