"""HTML -> PDF. WeasyPrint in containers (needs Pango); a minimal pure-Python text PDF fallback keeps
development and unit tests working on machines without the native libraries."""

from __future__ import annotations

import html
import re


def html_to_pdf(html_doc: str) -> bytes:
    try:
        from weasyprint import HTML

        return bytes(HTML(string=html_doc).write_pdf())
    except Exception:
        return _text_pdf(_html_to_lines(html_doc))


def _html_to_lines(doc: str) -> list[str]:
    doc = re.sub(r"(?is)<(script|style).*?</\1>", "", doc)
    doc = re.sub(r"(?i)<br\s*/?>|</p>|</tr>|</h\d>|</li>|</div>", "\n", doc)
    doc = re.sub(r"(?i)</td>|</th>", "  ", doc)
    text = html.unescape(re.sub(r"<[^>]+>", "", doc))
    lines = [ln.strip() for ln in text.splitlines()]
    return [ln for ln in lines if ln]


def _esc(s: str) -> str:
    s = s.replace("₹", "Rs.")
    s = s.encode("latin-1", "replace").decode("latin-1")
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _text_pdf(lines: list[str]) -> bytes:
    pages: list[list[str]] = [lines[i : i + 50] for i in range(0, max(len(lines), 1), 50)] or [[]]
    objs: list[bytes] = []
    n_pages = len(pages)
    # 1 catalog, 2 pages, 3 font, then (page, content) pairs
    kids = " ".join(f"{4 + 2 * i} 0 R" for i in range(n_pages))
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>".encode())
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    for i, page in enumerate(pages):
        content = "BT /F1 10 Tf 50 800 Td 14 TL " + " ".join(f"({_esc(ln[:110])}) '" for ln in page) + " ET"
        cbytes = content.encode("latin-1")
        objs.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> "
            f"/Contents {5 + 2 * i} 0 R >>".encode()
        )
        objs.append(b"<< /Length " + str(len(cbytes)).encode() + b" >>\nstream\n" + cbytes + b"\nendstream")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for idx, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{idx} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)
