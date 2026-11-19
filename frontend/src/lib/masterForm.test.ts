import { cellText, emptyValues, type FormSpec, payload, refOptions, serverFieldErrors, toValues, validate } from "./masterForm";

const tiers: FormSpec = {
  slug: "cancellation-tiers", intro: "", effective_dated: true, rate_table: true, columns: ["min_days"],
  fields: [
    { name: "effective_from", label: "Effective from", kind: "date", required: true },
    { name: "effective_to", label: "Effective to", kind: "date", required: false },
    { name: "min_days", label: "From (days before check-in)", kind: "int", required: true, min: 0 },
    { name: "max_days", label: "To (days before check-in)", kind: "int", required: false, min: 0 },
    { name: "credit_percent", label: "Nights credited back (%)", kind: "decimal", required: true, min: 0, max: 100 },
    { name: "rounding_mode", label: "Rounding", kind: "choice", required: false, choices: [{ value: "DOWN", label: "Round down" }] },
  ],
};

const asf: FormSpec = {
  slug: "asf-rates", intro: "", effective_dated: true, rate_table: true, columns: [],
  fields: [
    { name: "unit_type_id", label: "Unit type", kind: "ref", required: true, ref: { slug: "unit-types", by: "id" } },
    { name: "company_id", label: "Company", kind: "ref", required: false, ref: { slug: "companies", by: "id", none_label: "All companies" } },
    { name: "amount", label: "Annual amount", kind: "decimal", required: true, locked_on_edit: "Add a new rate instead." },
    { name: "currency", label: "Currency", kind: "ref", required: false, ref: { slug: "currencies", by: "code" } },
  ],
};

describe("master-data forms", () => {
  it("explains problems in plain language, per field", () => {
    const v = { ...emptyValues(tiers), effective_from: "2027-04-01", effective_to: "2027-03-01", min_days: "30", max_days: "10", credit_percent: "150" };
    expect(validate(tiers, v)).toEqual({
      effective_to: "'Effective to' must be on or after 'Effective from'.",
      max_days: "'To' days must be the same as or more than 'From' days.",
      credit_percent: "Nights credited back (%) cannot be more than 100.",
    });
    expect(validate(tiers, emptyValues(tiers))).toMatchObject({ effective_from: "Effective from is required.", min_days: "From (days before check-in) is required." });
    expect(validate(tiers, { ...emptyValues(tiers), effective_from: "2027-04-01", min_days: "2.5", credit_percent: "abc" })).toMatchObject({
      min_days: "From (days before check-in) must be a whole number.",
      credit_percent: "Nights credited back (%) must be a number, e.g. 12.5.",
    });
  });

  it("sends typed values for a new row and only the changed fields for an edit", () => {
    const v = { ...emptyValues(tiers), effective_from: "2027-04-01", min_days: "0", max_days: "", credit_percent: "50", rounding_mode: "DOWN" };
    expect(payload(tiers, v)).toEqual({ effective_from: "2027-04-01", min_days: 0, credit_percent: "50", rounding_mode: "DOWN" });
    const row = { id: "t1", effective_from: "2027-04-01", effective_to: null, min_days: 0, max_days: 6, credit_percent: "50.00", rounding_mode: "DOWN" };
    expect(payload(tiers, { ...toValues(tiers, row), max_days: "7" }, row)).toEqual({ max_days: 7 });
    expect(payload(tiers, toValues(tiers, row), row)).toEqual({});
  });

  it("skips locked fields when editing and maps server errors to fields", () => {
    expect(validate(asf, { ...emptyValues(asf), unit_type_id: "u1", amount: "" }, true)).toEqual({});
    expect(serverFieldErrors(asf, [{ loc: ["amount"], msg: "x", type: "decimal_parsing" }, { loc: ["unit_type_id"], msg: "x", type: "missing" }]))
      .toEqual({ amount: "Annual amount must be a number.", unit_type_id: "Unit type is required." });
  });

  it("shows names, never IDs, and the 'none' label for empty references", () => {
    const refs = {
      "unit-types": [{ id: "u1", code: "T1", name: "One-bedroom", is_active: true }, { id: "u0", code: "T0", name: "Studio", is_active: false }],
      companies: [{ id: "c1", code: "CLUB8", name: "Club8 Holidays" }],
      currencies: [{ id: "x", code: "INR", name: "Indian Rupee" }],
    };
    const row = { unit_type_id: "u0", company_id: null, amount: "15000.00", currency: "INR" };
    const [unit, company, amount, currency] = asf.fields;
    expect(cellText(unit!, row, refs)).toBe("Studio"); // inactive rows still show their name
    expect(cellText(company!, row, refs)).toBe("All companies");
    expect(cellText(amount!, row, refs)).toBe("₹15,000.00");
    expect(cellText(currency!, row, refs)).toBe("Indian Rupee");
    expect(refOptions(unit!, refs["unit-types"]).map((o) => o.label)).toEqual(["One-bedroom"]); // inactive not offered
    expect(refOptions(unit!, refs["unit-types"], "u0").map((o) => o.label)).toEqual(["One-bedroom", "Studio"]);
  });
});
