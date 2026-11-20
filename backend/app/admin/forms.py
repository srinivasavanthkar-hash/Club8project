"""Form descriptions for the master-data screens (Admin > Master data & rates).

One generic, schema-driven form for every table: the fields come from the SQLAlchemy columns, with plain labels,
help text, dropdowns of names for related records (never IDs), choices for fixed lists, dates, ticks for yes/no
fields and lists. The frontend renders forms and tables from this description; nobody types JSON (an admin-only
"Advanced (JSON)" view remains as a hidden fallback).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Boolean, Date, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB

from app.admin.service import MASTER, RATE_TABLES, SYSTEM_COLS

# Labels used wherever the column appears (a table may override).
LABELS = {
    "code": "Code",
    "name": "Name",
    "is_active": "Active",
    "sort_order": "Display order",
    "effective_from": "Effective from",
    "effective_to": "Effective to",
    "legal_name": "Legal name",
    "brand": "Brand name",
    "membership_prefix": "Membership number prefix",
    "receipt_prefix": "Receipt number prefix",
    "registered_address": "Registered address",
    "gstin": "GSTIN",
    "logo_path": "Logo file",
    "primary_colour": "Primary colour",
    "accent_colour": "Accent colour",
    "details_pending_confirmation": "Legal details still to be confirmed",
    "description": "Description",
    "priority": "Priority",
    "season_id": "Season",
    "destination_id": "Destination",
    "start_date": "First day",
    "end_date": "Last day",
    "max_adults": "Maximum adults",
    "max_children": "Maximum children",
    "child_age_limit": "Child age limit (years)",
    "max_total": "Maximum guests in total",
    "occupancy_text": "Occupancy shown to staff",
    "company_id": "Company",
    "allowed_tenures": "Allowed tenures (years)",
    "product_id": "Product",
    "field_key": "Field key",
    "label": "Label",
    "field_type": "Field type",
    "required": "Required",
    "options": "Choices (one per line)",
    "section": "Section on the member form",
    "display_order": "Display order",
    "credits_nights": "Credits nights to the entitlement",
    "rate_percent": "Rate (%)",
    "unit_type_id": "Unit type",
    "amount": "Annual amount (before GST)",
    "currency": "Currency",
    "tax_code": "Tax",
    "booked_category": "Booked resort category",
    "booked_season": "Booked season",
    "booked_unit_type": "Booked unit type",
    "purchased_category": "Purchased resort category",
    "purchased_season": "Purchased season",
    "purchased_unit_type": "Purchased unit type",
    "multiplier": "Nights deducted per night stayed",
    "min_days": "From (days before check-in)",
    "max_days": "To (days before check-in)",
    "credit_percent": "Nights credited back (%)",
    "rounding_mode": "Rounding of credited nights",
    "gst_applicable": "GST applies",
    "requires_reservation": "Must be linked to a reservation",
    "requires_reference": "Needs a transaction reference",
    "allows_card_last4": "Card last 4 digits allowed",
    "requires_bank": "Needs the bank name",
    "symbol": "Symbol",
    "is_kyc": "KYC document",
    "is_sensitive": "Sensitive (downloads are logged)",
    "city": "City",
    "country": "Country",
    "resort_category_id": "Resort category",
    "address": "Address",
    "kind": "Used for",
    "holiday_date": "Date",
    "entity": "Record type",
    "allowed_next": "Allowed next statuses",
    "key": "Setting",
    "value": "Value",
    "subject": "Subject",
    "body_html": "Letter text",
}

# Help shown under the field.
HELP = {
    "effective_to": "Leave blank while this entry is current. Adding a newer entry closes it automatically.",
    "effective_from": "The first day this entry applies.",
    "sort_order": "Lower numbers are listed first.",
    "is_active": "Inactive entries stay on existing records but can no longer be chosen.",
    "membership_prefix": "Start of every new membership number for this company, e.g. MSMC8-.",
    "logo_path": "File in the brand folder, e.g. club8/club8-logo.png.",
    "primary_colour": "Hex colour such as #393186, used for headings in generated letters.",
    "accent_colour": "Hex colour such as #EF7F1B, used for the thin line under the letterhead.",
    "details_pending_confirmation": "While ticked, receipts cannot be issued in production.",
    "priority": "When seasons overlap, the lower number wins.",
    "destination_id": "Leave as 'All destinations' for a season that applies everywhere.",
    "child_age_limit": "Children older than this count as adults.",
    "allowed_tenures": "Separate with commas, e.g. 10, 15, 25.",
    "field_key": "Short name used in exports, letters only, e.g. spouse_name.",
    "amount": "GST is added on top when the ASF is charged; currencies are never mixed.",
    "rate_percent": "For example 18 for 18% GST.",
    "multiplier": "1 = one entitlement night per night stayed; 1.5 = one and a half; leave the other fields as 'Any' "
    "to match every value.",
    "min_days": "0 = cancelled on the day of check-in.",
    "max_days": "Leave blank for 'or more'.",
    "credit_percent": "Share of the deducted nights given back, e.g. 50.",
    "tax_code": "Which tax rate applies (Tax rates table).",
    "key": "Settings are listed in docs/BUSINESS_RULES.md.",
    "allowed_next": "Statuses a record can move to from this one.",
}

# Fields kept out of the form (set by the system or by a separate flow).
FORM_HIDDEN = {"asf-rates": {"override_reason"}}

# Fixed choices.
CHOICES: dict[str, list[tuple[str, str]]] = {
    "rounding_mode": [("DOWN", "Round down to the half night"), ("UP", "Round up"), ("HALF_UP", "Nearest half night")],
    "field_type": [
        ("text", "Text"),
        ("number", "Number"),
        ("date", "Date"),
        ("bool", "Yes / no"),
        ("select", "Choice"),
    ],
    "kind": [
        ("DECLINE", "Declining a reservation"),
        ("CANCEL", "Cancelling a reservation"),
        ("CALL_OUTCOME", "Call outcome"),
        ("DUPLICATE_OVERRIDE", "Overriding a duplicate warning"),
    ],
    "entity": [("LEAD", "Lead"), ("MEMBER", "Member"), ("RESERVATION", "Reservation")],
}

# Text columns that hold the code of a row in another table: a dropdown of names, the code is stored.
CODE_REFS: dict[str, tuple[str, str | None]] = {
    "booked_category": ("resort-categories", "Any category"),
    "purchased_category": ("resort-categories", "Any category"),
    "booked_season": ("seasons", "Any season"),
    "purchased_season": ("seasons", "Any season"),
    "booked_unit_type": ("unit-types", "Any unit type"),
    "purchased_unit_type": ("unit-types", "Any unit type"),
    "tax_code": ("tax-rates", None),
    "currency": ("currencies", None),
}
NONE_LABELS = {
    "destination_id": "All destinations",
    "company_id": "All companies",
    "product_id": "All products",
    "tax_code": "No tax",
}

# Columns shown in the list table, in order (default: the first few form fields).
LIST_COLUMNS: dict[str, list[str]] = {
    "companies": ["code", "brand", "legal_name", "membership_prefix", "receipt_prefix", "is_active"],
    "season-calendar": ["season_id", "destination_id", "start_date", "end_date"],
    "unit-types": ["code", "name", "max_adults", "max_children", "max_total", "is_active"],
    "products": ["code", "name", "company_id", "allowed_tenures", "is_active"],
    "custom-fields": ["label", "field_key", "product_id", "field_type", "required", "is_active"],
    "tax-rates": ["code", "rate_percent", "effective_from", "effective_to"],
    "asf-rates": ["unit_type_id", "company_id", "amount", "currency", "effective_from", "effective_to"],
    "deduction-matrix": [
        "purchased_category",
        "purchased_season",
        "booked_category",
        "booked_season",
        "booked_unit_type",
        "multiplier",
        "effective_from",
        "effective_to",
    ],
    "cancellation-tiers": ["min_days", "max_days", "credit_percent", "rounding_mode", "effective_from", "effective_to"],
    "properties": ["code", "name", "destination_id", "resort_category_id", "is_active"],
    "reasons": ["code", "name", "kind", "is_active"],
    "holidays": ["holiday_date", "name"],
    "statuses": ["entity", "code", "label", "allowed_next"],
    "settings": ["key", "value", "description"],
    "letter-templates": ["code", "name", "subject", "is_active"],
}

INTRO = {
    "asf-rates": "The Annual Subscription Fee per unit type. Rates are effective-dated: add a new rate from a later "
    "date instead of changing an amount; the previous rate is closed automatically. Increases above the agreement "
    "cap need an override reason, which is logged.",
    "tax-rates": "Tax rates by code (e.g. GST on the ASF). Add a new rate from a later date when the rate changes.",
    "deduction-matrix": "How many entitlement nights one night costs when the booked stay differs from what the "
    "member purchased (for example an upgrade to a higher season). 'Any' matches every value; the most specific "
    "matching row wins.",
    "cancellation-tiers": "How many of the deducted nights are credited back, by how many days before check-in the "
    "reservation is cancelled.",
    "season-calendar": "Which season applies on which dates, for all destinations or one destination.",
    "letter-templates": "Wording of generated letters. The logo, company name and address are added automatically. "
    "Use the preview to check the result with fictitious sample data.",
}

_TABLE_OF_SLUG = {model.__tablename__: slug for slug, model in MASTER.items()}


def _kind(col: Any) -> str:
    t = col.type
    if isinstance(t, Boolean):
        return "bool"
    if isinstance(t, Integer):
        return "int"
    if isinstance(t, Numeric):
        return "decimal"
    if isinstance(t, Date):
        return "date"
    if isinstance(t, Text):
        return "textarea"
    if isinstance(t, JSONB):
        return "json"
    if isinstance(t, String):
        return "text"
    return "text"


def field_spec(slug: str, col: Any) -> dict[str, Any]:
    name = col.name
    spec: dict[str, Any] = {
        "name": name,
        "label": LABELS.get(name, name.removesuffix("_id").replace("_", " ").capitalize()),
        "kind": _kind(col),
        "required": not (col.nullable or col.default is not None or col.server_default is not None),
    }
    if isinstance(col.type, String) and col.type.length:
        spec["max_length"] = col.type.length
    default = getattr(col.default, "arg", None)
    if isinstance(default, (str, int, bool)) and not callable(default) and default != "":
        spec["default"] = default  # a new entry starts with it (e.g. currency INR, tax GST_ASF, active)
    if name in HELP:
        spec["help"] = HELP[name]
    fks = list(col.foreign_keys)
    if fks:
        target = fks[0].column.table.name
        spec |= {"kind": "ref", "ref": {"slug": _TABLE_OF_SLUG[target], "by": "id"}}
        if col.nullable:
            spec["ref"]["none_label"] = NONE_LABELS.get(name, "None")
    elif name in CODE_REFS:
        ref_slug, any_label = CODE_REFS[name]
        spec |= {"kind": "ref", "ref": {"slug": ref_slug, "by": "code"}}
        if any_label or col.nullable:
            spec["ref"]["none_label"] = any_label or NONE_LABELS.get(name, "None")
    elif name in CHOICES:
        spec |= {"kind": "choice", "choices": [{"value": v, "label": lbl} for v, lbl in CHOICES[name]]}
    if name in ("primary_colour", "accent_colour"):
        spec["kind"] = "colour"
    if name == "allowed_tenures":
        spec["kind"] = "int_list"
    if name in ("options", "allowed_next"):
        spec["kind"] = "str_list"
    if name == "body_html":
        spec["kind"] = "letter"
    if name == "value" and slug == "settings":
        spec["kind"] = "setting_value"
    if name == "multiplier":
        spec["min_exclusive"] = 0
    if name in ("rate_percent", "credit_percent"):
        spec |= {"min": 0, "max": 100}
    if name in ("amount", "min_days", "max_days", "max_adults", "max_children", "child_age_limit", "max_total"):
        spec["min"] = 0
    if slug == "asf-rates" and name in ("amount", "effective_from"):
        spec["locked_on_edit"] = "ASF rates are effective-dated: add a new rate instead of changing this."
    if slug == "settings" and name == "key":
        spec["locked_on_edit"] = "The setting name is fixed."
    return spec


def form_for(slug: str) -> dict[str, Any]:
    model = MASTER[slug]
    hidden = SYSTEM_COLS | FORM_HIDDEN.get(slug, set())
    fields = [field_spec(slug, c) for c in model.__table__.columns if c.name not in hidden]
    names = [f["name"] for f in fields]
    default_cols = [n for n in names if n not in ("description", "registered_address", "address", "body_html")][:5]
    if "is_active" in names and "is_active" not in default_cols:
        default_cols.append("is_active")
    return {
        "slug": slug,
        "intro": INTRO.get(slug, ""),
        "effective_dated": "effective_from" in names,
        "rate_table": slug in RATE_TABLES,
        "fields": fields,
        "columns": [c for c in LIST_COLUMNS.get(slug, default_cols) if c in names],
    }


def all_forms() -> dict[str, dict[str, Any]]:
    return {slug: form_for(slug) for slug in MASTER}
