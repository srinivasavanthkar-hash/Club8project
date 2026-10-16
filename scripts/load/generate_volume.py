"""Bulk-generate FICTITIOUS volume data for load testing (100k members, ~1M payments) straight into
PostgreSQL with COPY-speed inserts. Never run against production.

    CRM_DATABASE_URL=... python scripts/load/generate_volume.py --members 100000 --payments-per-member 10
"""

import argparse
import asyncio
import os
import random
import sys
import uuid
from datetime import date, timedelta
from decimal import Decimal

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))


async def main(n_members: int, per_member: int, offset: int = 0) -> None:
    import asyncpg

    from app.core.config import get_settings

    url = get_settings().database_url.get_secret_value().replace("postgresql+asyncpg://", "postgresql://")
    if get_settings().env == "prod":
        raise SystemExit("Refusing to generate load data in production")
    conn = await asyncpg.connect(url)
    rng = random.Random(1)
    ids = {r["code"]: r["id"] for r in await conn.fetch("SELECT code, id FROM companies")}
    cat = await conn.fetchval("SELECT id FROM resort_categories WHERE code='PREMIUM'")
    season = await conn.fetchval("SELECT id FROM seasons WHERE code='RED'")
    unit = await conn.fetchval("SELECT id FROM unit_types WHERE code='T0'")
    method = await conn.fetchval("SELECT id FROM payment_methods WHERE code='UPI'")
    company = ids["CLUB8"]
    batch = 5000
    for start in range(offset, offset + n_members, batch):
        members, applicants, payments = [], [], []
        for i in range(start, min(start + batch, offset + n_members)):
            mid = uuid.uuid4()
            seq = str(500000 + i)
            members.append((mid, company, f"MSMC8-{seq}", seq, "ACTIVE", f"load{i}@example.com", "1 Load St", "Pune",
                            "411001", "Maharashtra", "India", date(2025, 1, 1), 10, 2025, 2034, cat, season, unit,
                            Decimal("7"), "INR", Decimal("200000"), Decimal("0"), Decimal("200000"),
                            Decimal("200000"), Decimal("0"), "NONE", "{}", Decimal("0"), 1, False, False, False))
            applicants.append((uuid.uuid4(), mid, 1, f"Load Member {i}", f"load member {i}", date(1980, 1, 1),
                               f"9{rng.randint(100000000, 999999999)}", 1))
            for k in range(per_member):
                amt = Decimal(rng.randint(1000, 30000))
                payments.append((uuid.uuid4(), mid, company, "MEMBERSHIP_EMI", "NORMAL", amt, Decimal(0), Decimal(0),
                                 amt, "INR", date(2025, 1, 1) + timedelta(days=k * 30), method,
                                 f"LOAD-{i}-{k}", f"RCLOAD-{i}-{k}", False, 1))
        await conn.copy_records_to_table("members", records=members, columns=[
            "id", "company_id", "membership_number", "membership_seq", "status", "email", "address_line1", "city",
            "postcode", "state", "country", "purchase_date", "tenure_years", "first_year_of_use", "last_year_of_use",
            "resort_category_id", "season_id", "unit_type_id", "nights_per_year", "currency", "purchase_price",
            "admin_fees", "total_price", "down_payment_amount", "balance", "balance_mode", "custom_fields",
            "credit_balance", "version", "agreement_signed_applicant1", "agreement_signed_applicant2",
            "agreement_signed_company"])
        await conn.copy_records_to_table("member_applicants", records=applicants, columns=[
            "id", "member_id", "position", "full_name", "name_norm", "dob", "mobile", "version"])
        await conn.copy_records_to_table("payments", records=payments, columns=[
            "id", "member_id", "company_id", "payment_type_code", "entry_kind", "base_amount", "gst_rate",
            "gst_amount", "total_amount", "currency", "payment_date", "payment_method_id", "transaction_ref",
            "receipt_number", "is_forfeited", "version"])
        print(f"{min(start + batch, offset + n_members)} members")
    await conn.execute("ANALYZE")
    await conn.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--members", type=int, default=100_000)
    p.add_argument("--payments-per-member", type=int, default=10)
    p.add_argument("--offset", type=int, default=0, help="start numbering here (append to existing load data)")
    a = p.parse_args()
    asyncio.run(main(a.members, a.payments_per_member, a.offset))
