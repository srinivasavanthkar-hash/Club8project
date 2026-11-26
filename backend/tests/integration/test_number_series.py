"""Membership number series (Phase 2): prefixes by company and, optionally, sales venue and property.

Demo series (app/seed_demo.py, FICTITIOUS): MSMC8 (Club8, any venue/property, next 9001), MSMK8 (K8), MSMBL (Club8,
venue DEMO-BLR-EXPO), C8MPR (Club8, property GOA-DEMO-PREM), C8MTHN (Club8, venue DEMO-THANE + property OOTY-DEMO-SUP).
"""

import asyncio
from typing import Any

from app.demo_scenario import master

from .helpers import member_payload, ok


async def _series(api: Any, prefix: str) -> dict[str, Any]:
    return await master(api, "number-series", prefix, key="prefix")


async def _ids(api: Any) -> dict[str, str]:
    venues = {v["code"]: v["id"] for v in ok(await api.get("/api/v1/admin/master/venues"))}
    props = {p["code"]: p["id"] for p in ok(await api.get("/api/v1/admin/master/properties"))}
    return {"expo": venues["DEMO-BLR-EXPO"], "thane": venues["DEMO-THANE"], "goa": props["GOA-DEMO-PREM"],
            "ooty": props["OOTY-DEMO-SUP"]}  # fmt: skip


async def test_the_most_specific_series_that_fits_gives_the_number(api: Any) -> None:
    await api.login("demo.sales")
    ids = await _ids(api)
    plain = ok(await api.post("/api/v1/members", json=await member_payload(api)), 201)
    assert plain["membership_number"].startswith("MSMC8-")
    assert plain["number_series_id"] == (await _series(api, "MSMC8"))["id"]

    expo = ok(await api.post("/api/v1/members", json=await member_payload(api, venue_id=ids["expo"])), 201)
    assert expo["membership_number"].startswith("MSMBL-") and expo["venue_id"] == ids["expo"]

    goa = ok(await api.post("/api/v1/members", json=await member_payload(api, home_property_id=ids["goa"])), 201)
    assert goa["membership_number"].startswith("C8MPR-") and goa["home_property_id"] == ids["goa"]

    both = await member_payload(api, venue_id=ids["thane"], home_property_id=ids["ooty"])
    assert ok(await api.post("/api/v1/members", json=both), 201)["membership_number"].startswith("C8MTHN-")


async def test_staff_can_choose_another_series_that_fits_but_not_one_that_does_not(api: Any) -> None:
    await api.login("demo.sales")
    ids = await _ids(api)
    msmc8, c8mpr = await _series(api, "MSMC8"), await _series(api, "C8MPR")
    p = await member_payload(api, venue_id=ids["expo"], number_series_id=msmc8["id"])
    assert ok(await api.post("/api/v1/members", json=p), 201)["membership_number"].startswith("MSMC8-")
    p = await member_payload(api, venue_id=ids["expo"], number_series_id=c8mpr["id"])  # C8MPR is for a property
    r = await api.post("/api/v1/members", json=p)
    assert r.status_code == 422 and r.json()["code"] == "NumberSeriesNotApplicable"


async def test_two_equally_specific_series_ask_for_a_choice(api: Any) -> None:
    await api.login("demo.sales")
    ids = await _ids(api)
    company = await master(api, "companies", "CLUB8")
    params = {"company_id": company["id"], "purchase_date": "2026-11-16", "venue_id": ids["expo"],
              "home_property_id": ids["goa"]}  # fmt: skip
    fits = ok(await api.get("/api/v1/members/number-series", params=params))
    assert [s["prefix"] for s in fits["items"]] == ["C8MPR", "MSMBL", "MSMC8"] and fits["default_id"] is None
    assert all(s["to_be_confirmed"] for s in fits["items"])
    p = await member_payload(api, venue_id=ids["expo"], home_property_id=ids["goa"])
    r = await api.post("/api/v1/members", json=p)
    assert (
        r.status_code == 422
        and r.json()["code"] == "ChooseNumberSeries"
        and "C8MPR, MSMBL, MSMC8" in r.json()["detail"]
    )

    venue_only = {k: v for k, v in params.items() if k != "home_property_id"}
    one = ok(await api.get("/api/v1/members/number-series", params=venue_only))
    assert one["default_id"] == (await _series(api, "MSMBL"))["id"]


async def test_no_series_before_the_first_one_starts(api: Any) -> None:
    await api.login("demo.sales")
    p = await member_payload(api, purchase_date="2019-06-01", first_year_of_use=2019)
    r = await api.post("/api/v1/members", json=p)
    assert r.status_code == 422 and r.json()["code"] == "NoNumberSeries"
    assert "01-06-2019" in r.json()["detail"]


async def test_typed_number_part_and_duplicates_within_a_series(api: Any) -> None:
    await api.login("demo.sales")
    ids = await _ids(api)
    m = ok(
        await api.post(
            "/api/v1/members", json=await member_payload(api, venue_id=ids["expo"], membership_number="00654")
        ),
        201,
    )
    assert m["membership_number"] == "MSMBL-654"
    r = await api.post("/api/v1/members", json=await member_payload(api, venue_id=ids["expo"], membership_number="654"))
    assert r.status_code == 409 and r.json()["code"] == "DuplicateMembershipNumber"
    # the same number part in another series is a different membership number
    other = await member_payload(api, membership_number="654")
    assert ok(await api.post("/api/v1/members", json=other), 201)["membership_number"] == "MSMC8-654"

    # search: the number part finds both; the full number (any prefix, any case) finds one
    res = ok(await api.get("/api/v1/search", params={"q": "654"}))
    found = {x["membership_number"] for x in res["members"]}
    assert {"MSMBL-654", "MSMC8-654"} <= found
    res = ok(await api.get("/api/v1/search", params={"q": "msmbl-654"}))
    assert [x["membership_number"] for x in res["members"]] == ["MSMBL-654"]
    listed = ok(await api.get("/api/v1/members", params={"q": "MSMBL-654"}))
    assert [x["membership_number"] for x in listed["items"]] == ["MSMBL-654"]


async def test_two_saves_at_once_never_get_the_same_number(api: Any) -> None:
    await api.login("demo.sales")
    ids = await _ids(api)
    payloads = [await member_payload(api, venue_id=ids["thane"], home_property_id=ids["ooty"]) for _ in range(3)]
    results = await asyncio.gather(*(api.post("/api/v1/members", json=p) for p in payloads))
    numbers = [ok(r, 201)["membership_number"] for r in results]
    assert len(set(numbers)) == 3 and all(n.startswith("C8MTHN-") for n in numbers)


async def test_admin_series_checks_in_plain_language(api: Any) -> None:
    await api.login("demo.manager")
    company = await master(api, "companies", "CLUB8")
    url = "/api/v1/admin/master/number-series"
    base = {"company_id": company["id"], "next_number": 1, "active_from": "2031-01-01"}

    ids = await _ids(api)
    own = {"venue_id": ids["thane"], "property_id": ids["goa"]}  # a venue and property no other series covers
    # lower case is accepted and stored in capitals
    r = await api.post(url, json={**base, **own, "prefix": "ab", "active_from": "2026-01-01"})
    created = ok(r, 201)
    assert created["prefix"] == "AB" and created["to_be_confirmed"] is False
    r = await api.post(url, json={**base, "prefix": "M-1"})
    assert r.status_code == 422 and r.json()["detail"] == "The prefix is 2 to 10 capital letters or digits, e.g. MSMC8."
    r = await api.post(url, json={**base, "prefix": "MSMC8"})
    assert r.json()["detail"] == "The prefix MSMC8 is already used by another series."
    # MSMC8 already covers Club8 / any venue / any property with no end date
    assert (await api.post(url, json={**base, "prefix": "ZZ"})).json()["code"] == "SeriesOverlap"
    r = await api.post(url, json={**base, "prefix": "ZY", "active_from": "2031-02-01", "active_to": "2031-01-01"})
    assert r.json()["detail"] == "'Active to' must be on or after 'Active from'."

    # AB is the most specific series for its venue + property: its own counter, untouched by other tests
    r = await api.patch(f"{url}/{created['id']}", json={"prefix": "AC"})
    assert r.status_code == 422 and r.json()["code"] == "SeriesFixed"
    await api.login("demo.sales")
    m = await member_payload(api, venue_id=own["venue_id"], home_property_id=own["property_id"])
    assert ok(await api.post("/api/v1/members", json=m), 201)["membership_number"] == "AB-1"
    await api.login("demo.manager")
    r = await api.patch(f"{url}/{created['id']}", json={"next_number": 1})
    assert r.status_code == 422 and r.json()["code"] == "SeriesNextNumberTooLow"
    assert r.json()["detail"] == "The next number must be above 1, the highest number already issued from this series."
    ok(await api.patch(f"{url}/{created['id']}", json={"next_number": 11, "notes": "Skip ten."}))

    # changes are in the activity log
    log = ok(await api.get("/api/v1/activity-log", params={"entity_type": "membership_number_series"}))
    refs = {x.get("entity_ref") for x in log["items"]}
    assert "AB" in refs


async def test_form_offers_the_series_without_json(api: Any) -> None:
    await api.login("demo.manager")
    form = ok(await api.get("/api/v1/admin/master-forms"))["number-series"]
    fields = {f["name"]: f for f in form["fields"]}
    assert fields["company_id"]["kind"] == "ref" and fields["company_id"]["locked_on_edit"]
    assert fields["venue_id"]["ref"]["none_label"] == "All sales venues"
    assert fields["property_id"]["ref"]["none_label"] == "All properties"
    assert fields["prefix"]["locked_on_edit"] and fields["active_from"]["kind"] == "date"
    assert fields["to_be_confirmed"]["kind"] == "bool"
    companies = ok(await api.get("/api/v1/admin/master-forms"))["companies"]
    assert "membership_prefix" not in {f["name"] for f in companies["fields"]}
