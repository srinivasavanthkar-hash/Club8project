"""Content-based file type detection. Uses libmagic (python-magic) when available, otherwise a strict
signature check for the three allowed types. Extension and client-sent content type are never trusted."""

SIGNATURES = {
    b"%PDF-": "application/pdf",
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG\r\n\x1a\n": "image/png",
}


def sniff(data: bytes) -> str | None:
    try:
        import magic

        detected: str = magic.from_buffer(data[:8192], mime=True)
        return detected
    except Exception:
        for sig, mime in SIGNATURES.items():
            if data.startswith(sig):
                return mime
        return None


def validate_upload(data: bytes, allowed: list[str], max_mb: int) -> str:
    from app.core.errors import RuleViolation

    if not data:
        raise RuleViolation("File is empty", code="EmptyFile")
    if len(data) > max_mb * 1024 * 1024:
        raise RuleViolation(f"File exceeds the {max_mb} MB limit", code="FileTooLarge")
    mime = sniff(data)
    if mime not in allowed:
        raise RuleViolation(
            f"File type {mime or 'unknown'} is not allowed (PDF, JPEG, PNG only)", code="FileTypeNotAllowed"
        )
    return mime
