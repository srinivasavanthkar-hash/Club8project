"""Generated letters (receipt, default notice, reservation voucher) from editable Jinja2 templates
(sandboxed). Each generated PDF is saved as a correspondence document."""

from __future__ import annotations

import base64
import re
import uuid
from functools import cache
from pathlib import Path
from typing import Any

from jinja2.sandbox import SandboxedEnvironment
from markupsafe import escape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.models import LetterTemplate
from app.auth.models import User
from app.core.config import get_settings
from app.core.errors import RuleViolation
from app.core.money import format_inr
from app.core.timeutil import fmt_date
from app.correspondence import documents
from app.correspondence.models import Document
from app.correspondence.pdf import html_to_pdf

_env = SandboxedEnvironment(autoescape=True)
_env.filters["inr"] = format_inr
_env.filters["ddmmyyyy"] = lambda d: fmt_date(d) if d else ""

# Fallback templates used only when the letter_templates row is missing (seeded rows are editable). The brand
# header (logo, legal name, address) is added by render(), so templates contain only the document itself.
_ORIGINAL_TEMPLATES = {
    "RECEIPT": """<h1>{{ company.legal_name }}</h1><p>Promoter of {{ company.brand }}</p>
<p>{{ company.registered_address }}{% if company.gstin %}<br>GSTIN: {{ company.gstin }}{% endif %}</p>
<h2>Payment Receipt {{ p.receipt_number }}</h2>
<p>Date: {{ p.payment_date|ddmmyyyy }}<br>Member: {{ m.membership_number }} - {{ name }}</p>
<table><tr><th>Description</th><td>{{ p.payment_type_code }}{% if p.asf_year %} (membership year {{ p.asf_year }}){% endif %}</td></tr>
<tr><th>Amount</th><td>{{ p.base_amount|inr }}</td></tr>
{% if p.gst_amount > 0 %}<tr><th>GST @ {{ p.gst_rate.normalize() }}%</th><td>{{ p.gst_amount|inr }}</td></tr>{% endif %}
<tr><th>Total ({{ p.currency }})</th><td>{{ p.total_amount|inr }}</td></tr>
<tr><th>Method</th><td>{{ method }}{% if p.card_last4 %} ending {{ p.card_last4 }}{% endif %}</td></tr>
<tr><th>Reference</th><td>{{ p.transaction_ref or p.cheque_number or '' }}</td></tr></table>
<p>This is a computer-generated receipt.</p>""",
    "DEFAULT_NOTICE": """<h1>{{ company.legal_name }}</h1><p>Promoter of {{ company.brand }}</p>
<h2>Notice of Default</h2><p>Date: {{ notice.issued_on|ddmmyyyy }}</p>
<p>To: {{ name }}<br>Membership No: {{ m.membership_number }}<br>{{ m.address_line1 }}, {{ m.city }}</p>
<p>Under the Default clause of your Membership Agreement, the following amount is overdue:
{{ notice.amount_overdue|inr }}.</p>
<p>Please pay the full overdue amount on or before {{ notice.deadline|ddmmyyyy }} (within {{ days }} days).
If payment is not received by then, the Company may terminate the membership. Payments made are
non-refundable under the agreement.</p>""",
    "RESERVATION_VOUCHER": """<h1>{{ company.brand }}</h1><h2>Reservation Confirmation / Voucher</h2>
<p>Reservation: {{ r.reservation_number }}<br>Confirmation No: {{ r.confirmation_number }}</p>
<p>Member: {{ m.membership_number }} - {{ name }}</p>
<p>Property: {{ property }}<br>Check-in: {{ r.check_in|ddmmyyyy }}<br>Check-out: {{ r.check_out|ddmmyyyy }}
<br>Nights: {{ r.nights }}<br>Guests: {{ r.adults }} adult(s), {{ r.child_ages|length }} child(ren)
{% if r.guest_name %}<br>Lead guest: {{ r.guest_name }}{% endif %}</p>""",
}


_RESTYLED_TEMPLATES = {
    "RECEIPT": """<h1>{{ company.legal_name }}</h1><p>Promoter of {{ company.brand }}</p>
<p>{{ company.registered_address }}{% if company.gstin %}<br>GSTIN: {{ company.gstin }}{% endif %}</p>
<h2>Payment Receipt <span class="ref">{{ p.receipt_number }}</span></h2>
<p>Date: <span class="ref">{{ p.payment_date|ddmmyyyy }}</span><br>Member: <span class="ref">{{ m.membership_number }}</span> - {{ name }}</p>
<table class="amounts"><tr><th>Description</th><td>{{ p.payment_type_code }}{% if p.asf_year %} (membership year {{ p.asf_year }}){% endif %}</td></tr>
<tr><th>Amount</th><td>{{ p.base_amount|inr }}</td></tr>
{% if p.gst_amount > 0 %}<tr><th>GST @ {{ p.gst_rate.normalize() }}%</th><td>{{ p.gst_amount|inr }}</td></tr>{% endif %}
<tr class="total"><th>Total ({{ p.currency }})</th><td>{{ p.total_amount|inr }}</td></tr>
<tr><th>Method</th><td>{{ method }}{% if p.card_last4 %} ending {{ p.card_last4 }}{% endif %}</td></tr>
<tr><th>Reference</th><td>{{ p.transaction_ref or p.cheque_number or '' }}</td></tr></table>
<p>This is a computer-generated receipt.</p>""",
    "DEFAULT_NOTICE": """<h1>{{ company.legal_name }}</h1><p>Promoter of {{ company.brand }}</p>
<h2>Notice of Default</h2><p>Date: {{ notice.issued_on|ddmmyyyy }}</p>
<p>To: {{ name }}<br>Membership No: <span class="ref">{{ m.membership_number }}</span><br>{{ m.address_line1 }}, {{ m.city }}</p>
<p>Under the Default clause of your Membership Agreement, the following amount is overdue:
{{ notice.amount_overdue|inr }}.</p>
<p>Please pay the full overdue amount on or before {{ notice.deadline|ddmmyyyy }} (within {{ days }} days).
If payment is not received by then, the Company may terminate the membership. Payments made are
non-refundable under the agreement.</p>""",
    "RESERVATION_VOUCHER": """<h1>{{ company.brand }}</h1><h2>Reservation Confirmation / Voucher</h2>
<p>Reservation: <span class="ref">{{ r.reservation_number }}</span><br>Confirmation No: <span class="ref">{{ r.confirmation_number }}</span></p>
<p>Member: <span class="ref">{{ m.membership_number }}</span> - {{ name }}</p>
<p>Property: {{ property }}<br>Check-in: {{ r.check_in|ddmmyyyy }}<br>Check-out: {{ r.check_out|ddmmyyyy }}
<br>Nights: {{ r.nights }}<br>Guests: {{ r.adults }} adult(s), {{ r.child_ages|length }} child(ren)
{% if r.guest_name %}<br>Lead guest: {{ r.guest_name }}{% endif %}</p>""",
}

DEFAULT_TEMPLATES = {
    "RECEIPT": """<h1>Payment Receipt <span class="ref">{{ p.receipt_number }}</span></h1>
<p>Date: <span class="ref">{{ p.payment_date|ddmmyyyy }}</span><br>Member: <span class="ref">{{ m.membership_number }}</span> - {{ name }}</p>
<table class="amounts"><tr><th>Description</th><td>{{ p.payment_type_code }}{% if p.asf_year %} (membership year {{ p.asf_year }}){% endif %}</td></tr>
<tr><th>Amount</th><td>{{ p.base_amount|inr }}</td></tr>
{% if p.gst_amount > 0 %}<tr><th>GST @ {{ p.gst_rate.normalize() }}%</th><td>{{ p.gst_amount|inr }}</td></tr>{% endif %}
<tr class="total"><th>Total ({{ p.currency }})</th><td>{{ p.total_amount|inr }}</td></tr>
<tr><th>Method</th><td>{{ method }}{% if p.card_last4 %} ending {{ p.card_last4 }}{% endif %}</td></tr>
<tr><th>Reference</th><td>{{ p.transaction_ref or p.cheque_number or '' }}</td></tr></table>
<p>This is a computer-generated receipt.</p>""",
    "DEFAULT_NOTICE": """<h1>Notice of Default</h1><p>Date: {{ notice.issued_on|ddmmyyyy }}</p>
<p>To: {{ name }}<br>Membership No: <span class="ref">{{ m.membership_number }}</span><br>{{ m.address_line1 }}, {{ m.city }}</p>
<p>Under the Default clause of your Membership Agreement, the following amount is overdue:
{{ notice.amount_overdue|inr }}.</p>
<p>Please pay the full overdue amount on or before {{ notice.deadline|ddmmyyyy }} (within {{ days }} days).
If payment is not received by then, the Company may terminate the membership. Payments made are
non-refundable under the agreement.</p>""",
    "RESERVATION_VOUCHER": """<h1>Reservation Confirmation / Voucher</h1>
<p>Reservation: <span class="ref">{{ r.reservation_number }}</span><br>Confirmation No: <span class="ref">{{ r.confirmation_number }}</span></p>
<p>Member: <span class="ref">{{ m.membership_number }}</span> - {{ name }}</p>
<p>Property: {{ property }}<br>Check-in: {{ r.check_in|ddmmyyyy }}<br>Check-out: {{ r.check_out|ddmmyyyy }}
<br>Nights: {{ r.nights }}<br>Guests: {{ r.adults }} adult(s), {{ r.child_ages|length }} child(ren)
{% if r.guest_name %}<br>Lead guest: {{ r.guest_name }}{% endif %}</p>""",
}

# Earlier default bodies (they printed the company header themselves). Migration 0002 swaps rows still identical
# to one of these for the new defaults; admin-edited templates are left alone.
PREVIOUS_DEFAULT_TEMPLATES: dict[str, list[str]] = {
    code: [_ORIGINAL_TEMPLATES[code], _RESTYLED_TEMPLATES[code]] for code in DEFAULT_TEMPLATES
}


# Brand logos (copies of frontend/public/brand/*/*-logo.png, kept identical by tests/unit/test_letters_brand.py).
BRAND_DIR = Path(__file__).parent / "brand"
# Opaque area (x0, y0, x1, y1, width, height) of logo files that carry extra transparent padding: the header frames
# this area so the artwork keeps its size. The file itself is never altered.
LOGO_FRAMES: dict[str, tuple[int, int, int, int, int, int]] = {
    "k8/k8-logo.png": (26, 28, 922, 512, 1053, 938),
}
LOGO_ALT = {"club8/club8-logo.png": "Club8 Holidays", "k8/k8-logo.png": "K8 Klub Eight Asia Ventures"}
LOGO_WIDTH_MM = 45
_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


@cache
def _logo_data_uri(logo_path: str) -> str | None:
    if not re.fullmatch(r"[a-z0-9_-]+/[a-z0-9_-]+\.png", logo_path):
        return None
    f = BRAND_DIR / logo_path
    return f"data:image/png;base64,{base64.b64encode(f.read_bytes()).decode()}" if f.is_file() else None


def _colour(value: str | None, fallback: str) -> str:
    return value if value and _HEX.match(value) else fallback


def brand_header(company: Any) -> str:
    """Logo top left (about 45 mm), legal entity and registered address top right, from the record's company."""
    if company is None:
        return ""
    logo_path = getattr(company, "logo_path", "") or ""
    uri = _logo_data_uri(logo_path) if logo_path else None
    logo = ""
    if uri:
        alt = escape(LOGO_ALT.get(logo_path, company.brand))
        frame = LOGO_FRAMES.get(logo_path)
        if frame:
            x0, y0, x1, y1, w, _h = frame
            scale = LOGO_WIDTH_MM / (x1 - x0)
            logo = (
                f'<div class="logo-frame" style="width:{LOGO_WIDTH_MM}mm;height:{(y1 - y0) * scale:.2f}mm">'
                f'<img src="{uri}" alt="{alt}" data-logo="{escape(logo_path)}" style="width:{w * scale:.2f}mm;'
                f'margin-left:-{x0 * scale:.2f}mm;margin-top:-{y0 * scale:.2f}mm"></div>'
            )
        else:
            logo = (
                f'<img class="logo" src="{uri}" alt="{alt}" data-logo="{escape(logo_path)}" '
                f'style="width:{LOGO_WIDTH_MM}mm">'
            )
    pending = bool(getattr(company, "details_pending_confirmation", False))
    entity = str(escape(company.legal_name))
    if not pending and company.brand and company.brand != company.legal_name:
        entity = f"{entity}, promoter of {escape(company.brand)}"
    lines = [f'<p class="entity">{entity}</p>']
    if company.registered_address:
        lines.append(f"<p>{escape(company.registered_address)}</p>")
    if company.gstin:
        lines.append(f"<p>GSTIN: {escape(company.gstin)}</p>")
    if pending:
        lines.append('<p class="pending">Legal entity details pending confirmation</p>')
    return (
        f'<table class="letterhead"><tr><td class="lh-logo">{logo}</td>'
        f'<td class="lh-entity">{"".join(lines)}</td></tr></table>'
    )


# Print styles shared by every letter (docs/DESIGN_SYSTEM.md, "Generated PDFs"). A4, print-safe black body text;
# the record's brand colours only in headings and one thin rule, so nothing depends on colour. The Default Notice
# is formal: no brand colour beyond the logo. __PRIMARY__ / __ACCENT__ come from the company (validated hex).
LETTER_CSS = """
@page { size: A4; margin: 18mm 16mm 20mm; @bottom-right { content: "Page " counter(page) " of " counter(pages);
  font-size: 8pt; color: #555; } }
body { font-family: "Inter", "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10.5pt; line-height: 1.45;
  color: #111; }
table.letterhead { width: 100%; margin: 0 0 14pt; padding-bottom: 8pt; border-bottom: 1.5pt solid __ACCENT__; }
table.letterhead td { border: 0; padding: 0; vertical-align: top; }
td.lh-logo { width: 50%; }
.logo-frame { overflow: hidden; }
.logo-frame img, img.logo { display: block; max-width: none; }
td.lh-entity { text-align: right; font-size: 8.5pt; line-height: 1.35; color: #333; }
td.lh-entity p { margin: 0 0 2pt; }
td.lh-entity .entity { font-weight: 600; color: #111; font-size: 9.5pt; }
td.lh-entity .pending { color: #111; font-weight: 600; border: 0.75pt solid #111; display: inline-block; padding: 1pt 4pt; }
h1 { font-size: 15pt; font-weight: 700; color: __PRIMARY__; margin: 4pt 0 8pt; }
h2 { font-size: 13pt; font-weight: 600; color: __PRIMARY__; margin: 16pt 0 6pt; }
p { margin: 0 0 8pt; }
.ref { font-family: "DejaVu Sans Mono", "Consolas", monospace; font-size: 0.95em; }
table { width: 100%; border-collapse: collapse; margin: 8pt 0 12pt; font-variant-numeric: tabular-nums; }
th, td { padding: 5pt 8pt; border-bottom: 0.5pt solid #bbb; text-align: left; vertical-align: top; }
th { width: 38%; font-weight: 600; color: #333; }
table.amounts td { text-align: right; }
tr.total th, tr.total td { font-weight: 700; border-top: 1pt solid #111; border-bottom: 1pt solid #111; }
.letter-default-notice h1, .letter-default-notice h2 { color: #111; }
.letter-default-notice table.letterhead { border-bottom-color: #111; }
"""


async def render(session: AsyncSession, code: str, ctx: dict[str, Any]) -> str:
    tpl = (
        await session.execute(
            select(LetterTemplate).where(LetterTemplate.code == code, LetterTemplate.is_active.is_(True))
        )
    ).scalar_one_or_none()
    source = tpl.body_html if tpl else DEFAULT_TEMPLATES.get(code)
    if source is None:
        raise RuleViolation(f"No letter template {code}", code="NoTemplate")
    body = _env.from_string(source).render(**ctx)
    company = ctx.get("company")
    css = LETTER_CSS.replace("__PRIMARY__", _colour(getattr(company, "primary_colour", None), "#111111")).replace(
        "__ACCENT__", _colour(getattr(company, "accent_colour", None), "#999999")
    )
    slug = code.lower().replace("_", "-")
    return (
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<style>{css}</style></head><body class='letter letter-{slug}'>{brand_header(company)}{body}</body></html>"
    )


async def generate(
    session: AsyncSession,
    *,
    code: str,
    doc_type_code: str,
    ctx: dict[str, Any],
    member_id: uuid.UUID,
    file_name: str,
    user: User | None,
    links: list[tuple[str, uuid.UUID]] | None = None,
) -> Document:
    company = ctx.get("company")
    if code == "RECEIPT" and getattr(company, "details_pending_confirmation", False) and get_settings().env == "prod":
        raise RuleViolation(
            f"Receipts for {getattr(company, 'brand', 'this company')} cannot be issued until its legal entity details are confirmed "
            "(Admin > Master data > Companies).",
            code="CompanyDetailsPending",
        )
    html_doc = await render(session, code, ctx)
    pdf = html_to_pdf(html_doc)
    dt = await documents.doc_type(session, doc_type_code)
    return await documents.store(
        session,
        data=pdf,
        file_name=file_name,
        document_type_id=dt.id,
        member_id=member_id,
        user=user,
        description=f"Generated {code}",
        links=links,
        generated=True,
    )
