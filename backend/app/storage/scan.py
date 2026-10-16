"""Virus-scan port.

* Azure: Microsoft Defender for Storage malware scanning scans each new blob and writes the result as the
  blob index tag "Malware Scanning scan result". The worker job `refresh_scan_results` polls PENDING
  documents every few minutes and marks them CLEAN/INFECTED (the API is internal-only, so no inbound
  webhook is exposed). Documents stay quarantined (no download URLs) until CLEAN.
* Local/dev: ClamAV (clamd INSTREAM) scans synchronously at upload.
"""

from __future__ import annotations

import asyncio
import struct
from typing import Protocol

from app.core.config import get_settings


class Scanner(Protocol):
    async def scan(self, data: bytes) -> str | None:
        """Returns CLEAN / INFECTED / ERROR synchronously, or None if the result arrives asynchronously."""


class NoopScanner:
    async def scan(self, data: bytes) -> str | None:
        return "CLEAN"


class DefenderScanner:
    async def scan(self, data: bytes) -> str | None:
        return None  # result arrives later as a blob index tag (see refresh_scan_results)


class ClamAVScanner:  # pragma: no cover - needs clamd
    def __init__(self, host: str, port: int) -> None:
        self.host, self.port = host, port

    async def scan(self, data: bytes) -> str | None:
        try:
            reader, writer = await asyncio.wait_for(asyncio.open_connection(self.host, self.port), 5)
            writer.write(b"zINSTREAM\0")
            for i in range(0, len(data), 65536):
                chunk = data[i : i + 65536]
                writer.write(struct.pack("!L", len(chunk)) + chunk)
            writer.write(struct.pack("!L", 0))
            await writer.drain()
            reply = (await asyncio.wait_for(reader.read(4096), 60)).decode(errors="replace")
            writer.close()
            if "FOUND" in reply:
                return "INFECTED"
            return "CLEAN" if "OK" in reply else "ERROR"
        except (OSError, TimeoutError):
            return "ERROR"


def get_scanner() -> Scanner:
    s = get_settings()
    if s.virus_scan_provider == "defender":
        return DefenderScanner()
    if s.virus_scan_provider == "clamav":
        return ClamAVScanner(s.clamav_host, s.clamav_port)
    return NoopScanner()
