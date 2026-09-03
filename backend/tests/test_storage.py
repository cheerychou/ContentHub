from app.storage import FakeStorage


def test_fake_storage_roundtrip():
    s = FakeStorage()
    s.ensure_buckets()
    s.put("master", "abc/cover.png", b"pngbytes", "image/png")
    assert s.get("master", "abc/cover.png") == b"pngbytes"
    assert s.presigned_get("master", "abc/cover.png").startswith("fake://")
    s.delete("master", "abc/cover.png")
    assert s.get("master", "abc/cover.png") is None
