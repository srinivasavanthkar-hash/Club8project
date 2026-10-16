"""Generated letters (receipt, default notice, reservation voucher) from editable Jinja2 templates
(sandboxed). Each generated PDF is saved as a correspondence document."""

from __future__ import annotations

import uuid
from typing import Any

from jinja2.sandbox import SandboxedEnvironment
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.models import LetterTemplate
from app.auth.models import User
from app.core.errors import RuleViolation
from app.core.money import format_inr
from app.core.timeutil import fmt_date
from app.correspondence import documents
from app.correspondence.models import Document
from app.correspondence.pdf import html_to_pdf

_env = SandboxedEnvironment(autoescape=True)
_env.filters["inr"] = format_inr
_env.filters["ddmmyyyy"] = lambda d: fmt_date(d) if d else ""

# Fallback templates used only when the letter_templates row is missing (seeded rows are editable).
DEFAULT_TEMPLATES = {
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
    return (
        f"<!doctype html><html><head><meta charset='utf-8'><style>body{{font-family:sans-serif;font-size:11pt}}"
        f"table{{border-collapse:collapse}}td,th{{border:1px solid #999;padding:4px 8px;text-align:left}}"
        f"</style></head><body>{body}</body></html>"
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
