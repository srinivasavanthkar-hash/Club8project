"""Master data is entered through forms, not JSON: the form description, plain-language checks and the letter-template
preview (fictitious sample data). Phase 1, item 4."""

from typing import Any

from app.admin.service import MASTER
from app.demo_scenario import master

from .helpers import ok


async def test_every_master_table_has_a_form_without_json_fields(api: Any) -> None:
    await api.login("demo.manager")
    forms = ok(await api.get("/api/v1/admin/master-forms"))
    assert set(forms) == set(MASTER)
    for slug, form in forms.items():
        kinds = {f["name"]: f["kind"] for f in form["fields"]}
        assert "json" not in kinds.values(), f"{slug} still has a JSON field"
        assert not {"id", "version", "created_by"} & kinds.keys()
        assert form["columns"] and set(form["columns"]) <= kinds.keys()
        for f in form["fields"]:
            assert f["label"] and "_" not in f["label"], f"{slug}.{f['name']} has no plain label"

    asf = {f["name"]: f for f in forms["asf-rates"]["fields"]}
    assert asf["unit_type_id"]["kind"] == "ref" and asf["unit_type_id"]["ref"] == {"slug": "unit-types", "by": "id"}
    assert asf["company_id"]["ref"]["none_label"] == "All companies"
    assert asf["effective_from"]["kind"] == "date" and "override_reason" not in asf
    assert asf["amount"]["locked_on_edit"]
    matrix = {f["name"]: f for f in forms["deduction-matrix"]["fields"]}
    assert matrix["booked_season"]["ref"] == {"slug": "seasons", "by": "code", "none_label": "Any season"}
    tiers = {f["name"]: f for f in forms["cancellation-tiers"]["fields"]}
    assert [c["value"] for c in tiers["rounding_mode"]["choices"]] == ["DOWN", "UP", "HALF_UP"]
    cal = {f["name"]: f for f in forms["season-calendar"]["fields"]}
    assert cal["season_id"]["ref"]["slug"] == "seasons" and cal["destination_id"]["ref"]["none_label"]
    assert {f["name"]: f["kind"] for f in forms["letter-templates"]["fields"]}["body_html"] == "letter"


async def test_master_data_checks_speak_plain_language(api: Any) -> None:
    await api.login("demo.manager")
    season = await master(api, "seasons", "RED")
    r = await api.post(
        "/api/v1/admin/master/season-calendar",
        json={"season_id": season["id"], "start_date": "2031-05-10", "end_date": "2031-05-01"},
    )
    assert r.status_code == 422 and r.json()["detail"] == "The last day must be on or after the first day."
    r = await api.post(
        "/api/v1/admin/master/cancellation-tiers",
        json={"min_days": 30, "max_days": 10, "credit_percent": "50", "effective_from": "2031-01-01"},
    )
    assert r.json()["detail"] == "'To' days must be the same as or more than 'From' days."
    r = await api.post(
        "/api/v1/admin/master/cancellation-tiers",
        json={"min_days": 30, "credit_percent": "150", "effective_from": "2031-01-01"},
    )
    assert r.json()["detail"] == "Nights credited back must be between 0 and 100%."
    r = await api.post(
        "/api/v1/admin/master/tax-rates",
        json={"code": "GST_X", "rate_percent": "5", "effective_from": "2031-02-01", "effective_to": "2031-01-01"},
    )
    assert r.json()["detail"] == "'Effective to' must be on or after 'Effective from'."
    row = ok(
        await api.post(
            "/api/v1/admin/master/season-calendar",
            json={"season_id": season["id"], "start_date": "2031-05-01", "end_date": "2031-05-10"},
        ),
        201,
    )
    r = await api.patch(f"/api/v1/admin/master/season-calendar/{row['id']}", json={"end_date": "2031-04-01"})
    assert r.status_code == 422 and r.json()["code"] == "SeasonDates"  # checked against the stored first day


async def test_letter_template_preview_uses_fictitious_data(api: Any) -> None:
    await api.login("demo.sales")
    body = {
        "code": "RECEIPT",
        "body_html": "<h1>Receipt {{ p.receipt_number }}</h1><p>{{ name }} {{ payment_type }}</p>",
    }
    assert (await api.post("/api/v1/admin/letter-templates/preview", json=body)).status_code == 403
    await api.login("demo.admin")
    html = ok(await api.post("/api/v1/admin/letter-templates/preview", json=body))["html"]
    assert "Receipt RC8-2027-000042" in html and "Asha Example Down payment" in html
    assert 'data-logo="club8/club8-logo.png"' in html  # the real letterhead around the sample letter
    r = await api.post("/api/v1/admin/letter-templates/preview", json={"code": "RECEIPT", "body_html": "{% if %}"})
    assert r.status_code == 400 and r.json()["detail"].startswith("The letter text has an error")


async def test_week_start_setting_is_a_choice_and_readable_by_all_staff(api: Any) -> None:
    await api.login("demo.sales")  # any signed-in user: every date field needs it
    assert ok(await api.get("/api/v1/ui-settings")) == {"week_start": "MONDAY"}

    await api.login("demo.manager")
    forms = ok(await api.get("/api/v1/admin/master-forms"))
    value = {f["name"]: f for f in forms["settings"]["fields"]}["value"]
    assert value["setting_choices"]["ui.week_start"] == [
        {"value": "MONDAY", "label": "Monday"},
        {"value": "SUNDAY", "label": "Sunday"},
    ]
    row = next(r for r in ok(await api.get("/api/v1/admin/master/settings")) if r["key"] == "ui.week_start")
    r = await api.patch(f"/api/v1/admin/master/settings/{row['id']}", json={"value": "FRIDAY"})
    assert r.status_code == 422 and r.json()["detail"] == "Choose one of: Monday, Sunday."
    ok(await api.patch(f"/api/v1/admin/master/settings/{row['id']}", json={"value": "SUNDAY"}))
    await api.login("demo.sales")
    assert ok(await api.get("/api/v1/ui-settings")) == {"week_start": "SUNDAY"}
