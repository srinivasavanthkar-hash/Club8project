"""Blob storage port.

Azure: private container, managed identity, *user-delegation* SAS (no account keys in the app).
Azurite (local): connection string, service SAS (emulator only).
Memory: tests.
Uploads go through the API (so content can be validated by magic bytes before storing); downloads and
previews use short-lived, read-only SAS URLs issued after a permission check.
"""

from __future__ import annotations

from datetime import timedelta
from functools import lru_cache
from typing import Protocol

from app.core.config import get_settings
from app.core.timeutil import now_utc


class BlobStore(Protocol):
    async def put(self, path: str, data: bytes, content_type: str) -> None: ...
    async def get(self, path: str) -> bytes: ...
    def read_url(self, path: str, filename: str, inline: bool) -> str: ...
    async def set_tag(self, path: str, key: str, value: str) -> None: ...
    async def get_tags(self, path: str) -> dict[str, str]: ...


DEFENDER_RESULT_TAG = "Malware Scanning scan result"


class MemoryBlobStore:
    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.tags: dict[str, dict[str, str]] = {}

    async def put(self, path: str, data: bytes, content_type: str) -> None:
        self.objects[path] = (data, content_type)

    async def get(self, path: str) -> bytes:
        return self.objects[path][0]

    def read_url(self, path: str, filename: str, inline: bool) -> str:
        return f"memory://{path}?disposition={'inline' if inline else 'attachment'}"

    async def set_tag(self, path: str, key: str, value: str) -> None:
        self.tags.setdefault(path, {})[key] = value

    async def get_tags(self, path: str) -> dict[str, str]:
        return dict(self.tags.get(path, {}))


class AzureBlobStore:  # pragma: no cover - needs Azure/Azurite
    def __init__(self) -> None:
        from azure.storage.blob.aio import BlobServiceClient

        s = get_settings()
        self.container = s.blob_container_documents
        self.minutes = s.sas_minutes
        if s.blob_provider == "azurite" and s.blob_connection_string:
            self.client = BlobServiceClient.from_connection_string(s.blob_connection_string.get_secret_value())
            self._azurite = True
        else:
            from azure.identity.aio import DefaultAzureCredential

            self.client = BlobServiceClient(s.blob_account_url, credential=DefaultAzureCredential())
            self._azurite = False
        self._udk = None
        self._udk_expiry = now_utc()
        # Browser-facing base URL (Azurite runs as "azurite" inside compose but 127.0.0.1 for the browser)
        self.public_base = s.blob_account_url.rstrip("/")
        self._container_ready = False

    async def put(self, path: str, data: bytes, content_type: str) -> None:
        from azure.core.exceptions import ResourceExistsError
        from azure.storage.blob import ContentSettings

        if self._azurite and not self._container_ready:  # Azure containers are created by Terraform
            try:
                await self.client.create_container(self.container)
            except ResourceExistsError:
                pass
            self._container_ready = True
        blob = self.client.get_blob_client(self.container, path)
        await blob.upload_blob(data, overwrite=False, content_settings=ContentSettings(content_type=content_type))

    async def get(self, path: str) -> bytes:
        blob = self.client.get_blob_client(self.container, path)
        data: bytes = await (await blob.download_blob()).readall()
        return data

    async def get_tags(self, path: str) -> dict[str, str]:
        blob = self.client.get_blob_client(self.container, path)
        return dict(await blob.get_blob_tags())

    async def set_tag(self, path: str, key: str, value: str) -> None:
        blob = self.client.get_blob_client(self.container, path)
        tags = await blob.get_blob_tags()
        tags[key] = value
        await blob.set_blob_tags(tags)

    async def refresh_delegation_key(self) -> None:
        if self._azurite:
            return
        if self._udk is None or self._udk_expiry - now_utc() < timedelta(minutes=30):
            start = now_utc() - timedelta(minutes=5)
            self._udk_expiry = now_utc() + timedelta(hours=6)
            self._udk = await self.client.get_user_delegation_key(start, self._udk_expiry)

    def read_url(self, path: str, filename: str, inline: bool) -> str:
        from azure.storage.blob import BlobSasPermissions, generate_blob_sas

        disposition = f'{"inline" if inline else "attachment"}; filename="{filename}"'
        expiry = now_utc() + timedelta(minutes=self.minutes)
        kwargs = dict(
            account_name=self.client.account_name,
            container_name=self.container,
            blob_name=path,
            permission=BlobSasPermissions(read=True),
            expiry=expiry,
            content_disposition=disposition,
        )
        if self._azurite:
            s = get_settings()
            raw = s.blob_connection_string.get_secret_value() if s.blob_connection_string else ""
            conn = dict(part.split("=", 1) for part in raw.split(";") if "=" in part)
            sas = generate_blob_sas(account_key=conn["AccountKey"], **kwargs)
        else:
            sas = generate_blob_sas(user_delegation_key=self._udk, **kwargs)
        return f"{self.public_base}/{self.container}/{path}?{sas}"


_memory = MemoryBlobStore()


@lru_cache
def get_blob_store() -> BlobStore:
    s = get_settings()
    if s.blob_provider == "memory":
        return _memory
    return AzureBlobStore()
