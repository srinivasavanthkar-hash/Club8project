"""Brand header of generated letters (docs/BRAND_PROMPT.md section 5). Fictitious company data only."""

from pathlib import Path
from types import SimpleNamespace

import pytest

from app.core.config import get_settings
from app.core.errors import RuleViolation
from app.correspondence import letters

FRONTEND_BRAND = Path(__file__).resolve().parents[3] / "frontend" / "public" / "brand"

CLUB8 = SimpleNamespace(
    legal_name="Multiple Sales and Marketing LLP",
    brand="CLUB8 Holidays",
    registered_address="DEMO ADDRESS",
    gstin=None,
    logo_path="club8/club8-logo.png",
    primary_colour="#393186",
    accent_colour="#EF7F1B",
    details_pending_confirmation=False,
)
K8 = SimpleNamespace(
    legal_name="Klub Eight Asia Ventures",
    brand="K8",
    registered_address="DEMO ADDRESS - pending confirmation",
    gstin=None,
    logo_path="k8/k8-logo.png",
    primary_colour="#172040",
    accent_colour="#BC9C23",
    details_pending_confirmation=True,
)


@pytest.mark.parametrize("logo", ["club8/club8-logo.png", "k8/k8-logo.png"])
def test_backend_logo_copies_match_the_supplied_files(logo: str) -> None:
    if not FRONTEND_BRAND.is_dir():
        pytest.skip("frontend/public/brand not present (backend-only checkout)")
    assert (letters.BRAND_DIR / logo).read_bytes() == (FRONTEND_BRAND / logo).read_bytes()


def test_club8_header_has_its_logo_and_the_llp_as_promoter() -> None:
    h = letters.brand_header(CLUB8)
    assert 'data-logo="club8/club8-logo.png"' in h and 'alt="Club8 Holidays"' in h
    assert "Multiple Sales and Marketing LLP, promoter of CLUB8 Holidays" in h
    assert "pending confirmation" not in h.lower()


def test_k8_header_never_shows_the_club8_llp_and_flags_pending_details() -> None:
    h = letters.brand_header(K8)
    assert 'data-logo="k8/k8-logo.png"' in h and 'alt="K8 Klub Eight Asia Ventures"' in h
    assert "Klub Eight Asia Ventures" in h
    assert "Multiple Sales and Marketing" not in h
    assert "Legal entity details pending confirmation" in h
    assert 'class="logo-frame"' in h  # padded file is framed, not edited


def test_colours_are_validated_before_use_in_styles() -> None:
    assert letters._colour("#393186", "#111111") == "#393186"
    for bad in ["red;}body{display:none", "#39318", "", None]:
        assert letters._colour(bad, "#111111") == "#111111"
    assert letters._logo_data_uri("../../etc/passwd") is None


async def test_k8_receipts_are_blocked_in_production_until_details_are_confirmed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "env", "prod")
    with pytest.raises(RuleViolation) as e:
        await letters.generate(
            None,  # type: ignore[arg-type]  # rejected before any database access
            code="RECEIPT",
            doc_type_code="PAYMENT_RECEIPT",
            ctx={"company": K8},
            member_id=None,  # type: ignore[arg-type]
            file_name="x.pdf",
            user=None,
        )
    assert e.value.code == "CompanyDetailsPending"
