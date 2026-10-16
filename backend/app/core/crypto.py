"""Field-level envelope encryption for KYC numbers.

Each value is encrypted with a fresh 256-bit data key (AES-GCM). The data key is wrapped by a
key-encryption key (KEK):
  * local/test: a KEK from settings (dev only);
  * Azure: a Key Vault RSA key, wrap/unwrap via managed identity (key never leaves Key Vault).
Stored format: "v1.<kek_id>.<b64 wrapped dek>.<b64 nonce>.<b64 ciphertext>".
Rotation: create a new Key Vault key version; `rewrap_all` job re-wraps DEKs (docs/ARCHITECTURE.md).

`lookup_hash` is an HMAC-SHA256 with a separate key so PAN duplicate checks never decrypt.
"""

import base64
import hashlib
import hmac
import os
from functools import lru_cache
from typing import Protocol

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import get_settings


class KeyWrapper(Protocol):
    kek_id: str

    def wrap(self, dek: bytes) -> bytes: ...
    def unwrap(self, wrapped: bytes) -> bytes: ...


class LocalKeyWrapper:
    def __init__(self, kek: bytes) -> None:
        self._aes = AESGCM(kek)
        self.kek_id = "local" + hashlib.sha256(kek).hexdigest()[:8]

    def wrap(self, dek: bytes) -> bytes:
        nonce = os.urandom(12)
        return nonce + self._aes.encrypt(nonce, dek, b"dek")

    def unwrap(self, wrapped: bytes) -> bytes:
        return self._aes.decrypt(wrapped[:12], wrapped[12:], b"dek")


class KeyVaultKeyWrapper:  # pragma: no cover - exercised in Azure environments only
    def __init__(self, vault_url: str, key_name: str) -> None:
        from azure.identity import DefaultAzureCredential
        from azure.keyvault.keys import KeyClient
        from azure.keyvault.keys.crypto import CryptographyClient, KeyWrapAlgorithm

        cred = DefaultAzureCredential()
        key = KeyClient(vault_url, cred).get_key(key_name)
        self._client = CryptographyClient(key, cred)
        self._alg = KeyWrapAlgorithm.rsa_oaep_256
        self.kek_id = (key.properties.version or "kv")[:12]

    def wrap(self, dek: bytes) -> bytes:
        return bytes(self._client.wrap_key(self._alg, dek).encrypted_key)

    def unwrap(self, wrapped: bytes) -> bytes:
        return bytes(self._client.unwrap_key(self._alg, wrapped).key)


@lru_cache
def get_wrapper() -> KeyWrapper:
    s = get_settings()
    if s.kyc_key_provider == "keyvault" and s.keyvault_url:
        return KeyVaultKeyWrapper(s.keyvault_url, s.keyvault_kyc_key_name)
    return LocalKeyWrapper(base64.b64decode(s.kyc_local_kek.get_secret_value()))


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def encrypt_field(plaintext: str, wrapper: KeyWrapper | None = None) -> str:
    w = wrapper or get_wrapper()
    dek = AESGCM.generate_key(bit_length=256)
    nonce = os.urandom(12)
    ct = AESGCM(dek).encrypt(nonce, plaintext.encode(), b"kyc")
    return ".".join(["v1", w.kek_id, _b64(w.wrap(dek)), _b64(nonce), _b64(ct)])


def decrypt_field(token: str, wrapper: KeyWrapper | None = None) -> str:
    w = wrapper or get_wrapper()
    version, _kek_id, wrapped, nonce, ct = token.split(".")
    if version != "v1":
        raise ValueError("Unknown ciphertext version")
    dek = w.unwrap(_unb64(wrapped))
    return AESGCM(dek).decrypt(_unb64(nonce), _unb64(ct), b"kyc").decode()


def lookup_hash(value: str) -> str:
    key = hashlib.sha256(b"lookup|" + get_settings().jwt_signing_key.get_secret_value().encode()).digest()
    return hmac.new(key, value.strip().upper().encode(), hashlib.sha256).hexdigest()
