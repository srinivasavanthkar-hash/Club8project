"""HTML -> PDF with WeasyPrint (needs Pango: in the api/worker Docker image and on the CI runner).

There is no fallback. If the engine cannot load, the api and the worker refuse to start (`require_engine`), the
health check reports `pdf_engine: error`, and a request that needs a PDF fails with "PDF engine unavailable":
never a plain-text document without the logo, ₹ or labels.

`CRM_PDF_ENGINE=test_stub` (backend tests only, refused in staging and prod by the settings) writes a small PDF that
says STUB_MARK ("TEST STUB, NOT A REAL DOCUMENT") on every page, so a stub can never pass for a real receipt.
"""

from __future__ import annotations

import html
import logging
import re
from functools import cache
from typing import Any

from app.core.config import get_settings
from app.core.errors import DomainError

log = logging.getLogger("crm.pdf")
STUB_MARK = "TEST STUB – NOT A REAL DOCUMENT"  # noqa: RUF001 - the en dash is intended


class PdfEngineUnavailable(DomainError):
    status = 503
    title = "PDF engine unavailable"


@cache
def _weasyprint_html() -> Any:
    """WeasyPrint's HTML class; raises if the library or its native libraries (Pango) cannot load."""
    from weasyprint import HTML

    return HTML


def engine_status() -> tuple[str, str]:
    """("ok" | "test_stub" | "error", detail) for the health check and startup."""
    if get_settings().pdf_engine == "test_stub":
        return "test_stub", "test stub (backend tests only)"
    try:
        _weasyprint_html()(string="<p>ok</p>").write_pdf()
    except Exception as e:  # ImportError / OSError (missing Pango) / anything the engine raises
        return "error", f"WeasyPrint cannot run: {type(e).__name__}: {e}"
    return "ok", "WeasyPrint"


def require_engine(component: str) -> None:
    """Called when the api and the worker start: without a working PDF engine they refuse to start."""
    status, detail = engine_status()
    if status == "error":
        log.critical(
            "%s cannot start: the PDF engine is unavailable (%s). Receipts, notices, vouchers and letters need it. "
            "Run the backend from its Docker image (WeasyPrint + Pango), or install Pango; see backend/README.md.",
            component,
            detail,
        )
        raise SystemExit(f"{component}: PDF engine unavailable ({detail})")
    if status == "test_stub":
        log.warning("%s: PDF engine is the TEST STUB; generated documents are marked as not real", component)


def html_to_pdf(html_doc: str) -> bytes:
    if get_settings().pdf_engine == "test_stub":
        return _stub_pdf([STUB_MARK, "", *_html_to_lines(html_doc), "", STUB_MARK])
    try:
        html_cls = _weasyprint_html()
    except Exception as e:
        log.error("PDF engine unavailable: %s: %s", type(e).__name__, e)
        raise PdfEngineUnavailable(
            "PDF engine unavailable: the document could not be created. Nothing was saved; please tell your "
            "administrator.",
            code="PdfEngineUnavailable",
        ) from e
    return bytes(html_cls(string=html_doc).write_pdf())


# ---- test stub -------------------------------------------------------------------------------------------------


def _html_to_lines(doc: str) -> list[str]:
    doc = re.sub(r"(?is)<(script|style).*?</\1>", "", doc)
    doc = re.sub(r"(?i)<br\s*/?>|</p>|</tr>|</h\d>|</li>|</div>", "\n", doc)
    doc = re.sub(r"(?i)</td>|</th>", "  ", doc)
    text = html.unescape(re.sub(r"<[^>]+>", "", doc))
    lines = [ln.strip() for ln in text.splitlines()]
    return [ln for ln in lines if ln]


def _esc(s: str) -> str:
    s = s.replace("₹", "INR ").encode("cp1252", "replace").decode("cp1252")  # WinAnsiEncoding = cp1252
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _stub_pdf(lines: list[str]) -> bytes:
    """Minimal text PDF for tests; the mark is drawn large at the top of every page."""
    pages: list[list[str]] = [lines[i : i + 45] for i in range(0, max(len(lines), 1), 45)] or [[]]
    objs: list[bytes] = []
    n_pages = len(pages)
    # 1 catalog, 2 pages, 3 font, then (page, content) pairs
    kids = " ".join(f"{4 + 2 * i} 0 R" for i in range(n_pages))
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>".encode())
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    for i, page in enumerate(pages):
        mark = f"BT /F1 20 Tf 1 0 0 rg 50 805 Td ({_esc(STUB_MARK)}) Tj ET "
        body = "BT 0 g /F1 10 Tf 50 770 Td 14 TL " + " ".join(f"({_esc(ln[:110])}) '" for ln in page) + " ET"
        cbytes = (mark + body).encode("cp1252")
        objs.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> "
            f"/Contents {5 + 2 * i} 0 R >>".encode()
        )
        objs.append(b"<< /Length " + str(len(cbytes)).encode() + b" >>\nstream\n" + cbytes + b"\nendstream")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for idx, body_obj in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{idx} 0 obj\n".encode() + body_obj + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)
