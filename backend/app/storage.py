import threading
from io import BytesIO
from typing import Protocol

from minio import Minio

from .config import settings

ZONES = ("source", "topic", "master", "publish")


class ObjectStorage(Protocol):
    def ensure_buckets(self) -> None: ...
    def put(self, zone: str, key: str, data: bytes, content_type: str) -> None: ...
    def put_stream(self, zone: str, key: str, fileobj, length: int, content_type: str) -> None: ...
    def get_bytes(self, zone: str, key: str) -> bytes: ...
    def presigned_get(self, zone: str, key: str, expires_seconds: int = 3600) -> str: ...
    def delete(self, zone: str, key: str) -> None: ...
    def list_keys(self, zone: str) -> list[str]: ...


class MinioStorage:
    def __init__(self, endpoint: str, access_key: str, secret_key: str,
                 prefix: str, secure: bool = False):
        self.client = Minio(endpoint, access_key=access_key,
                            secret_key=secret_key, secure=secure)
        self.buckets = {z: f"{prefix}{z}" for z in ZONES}

    def ensure_buckets(self) -> None:
        for name in self.buckets.values():
            if not self.client.bucket_exists(name):
                self.client.make_bucket(name)

    def put(self, zone: str, key: str, data: bytes, content_type: str) -> None:
        self.client.put_object(self.buckets[zone], key, BytesIO(data),
                               length=len(data), content_type=content_type)

    def put_stream(self, zone: str, key: str, fileobj, length: int,
                   content_type: str) -> None:
        self.client.put_object(self.buckets[zone], key, fileobj,
                               length=length, content_type=content_type)

    def get_bytes(self, zone: str, key: str) -> bytes:
        resp = self.client.get_object(self.buckets[zone], key)
        try:
            return resp.read()
        finally:
            resp.close()
            resp.release_conn()

    def presigned_get(self, zone: str, key: str, expires_seconds: int = 3600) -> str:
        from datetime import timedelta
        return self.client.presigned_get_object(
            self.buckets[zone], key, expires=timedelta(seconds=expires_seconds)
        )

    def delete(self, zone: str, key: str) -> None:
        self.client.remove_object(self.buckets[zone], key)

    def list_keys(self, zone: str) -> list[str]:
        return [obj.object_name
                for obj in self.client.list_objects(self.buckets[zone],
                                                    recursive=True)]


class FakeStorage:
    """内存实现，供单测使用（不依赖真实 MinIO）。"""

    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def ensure_buckets(self) -> None: ...
    def put(self, zone: str, key: str, data: bytes, content_type: str) -> None:
        self.objects[(zone, key)] = data
    def put_stream(self, zone: str, key: str, fileobj, length: int,
                   content_type: str) -> None:
        data = fileobj.read()
        if len(data) != length:
            raise ValueError(
                f"put_stream length mismatch for {zone}/{key}: "
                f"expected {length} bytes, got {len(data)}"
            )
        self.objects[(zone, key)] = data
    def get(self, zone: str, key: str) -> bytes | None:
        return self.objects.get((zone, key))
    def get_bytes(self, zone: str, key: str) -> bytes:
        return self.objects[(zone, key)]
    def presigned_get(self, zone: str, key: str, expires_seconds: int = 3600) -> str:
        return f"fake://{zone}/{key}"
    def delete(self, zone: str, key: str) -> None:
        self.objects.pop((zone, key), None)
    def list_keys(self, zone: str) -> list[str]:
        return [key for (z, key) in self.objects if z == zone]


_storage: ObjectStorage | None = None
_storage_lock = threading.Lock()


def get_storage() -> ObjectStorage:
    global _storage
    if _storage is None:
        with _storage_lock:
            if _storage is None:
                _storage = MinioStorage(
                    settings.minio_endpoint,
                    settings.minio_access_key,
                    settings.minio_secret_key,
                    settings.bucket_prefix,
                )
                _storage.ensure_buckets()
    return _storage
