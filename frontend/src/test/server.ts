import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

export const ids = {
  company: "11111111-1111-4111-8111-111111111111",
  cat: "22222222-2222-4222-8222-222222222222",
  season: "33333333-3333-4333-8333-333333333333",
  unit: "44444444-4444-4444-8444-444444444444",
  card: "55555555-5555-4555-8555-555555555555",
  series: "66666666-6666-4666-8666-666666666666",
};

const master: Record<string, unknown[]> = {
  companies: [{ id: ids.company, code: "CLUB8", name: "CLUB8 Holidays" }],
  venues: [],
  properties: [],
  "resort-categories": [{ id: ids.cat, code: "PREMIUM", name: "Premium" }],
  seasons: [{ id: ids.season, code: "RED", name: "Red" }],
  "unit-types": [{ id: ids.unit, code: "T0", name: "Studio", occupancy_text: "2 adults + 2 children below 10 years" }],
  "payment-methods": [{ id: ids.card, code: "CARD", name: "Card" }],
  "joining-offer-types": [],
  "asf-rates": [{ id: "a", unit_type_id: ids.unit, amount: "12000.00", effective_from: "2020-01-01", effective_to: null }],
};

export const handlers = [
  http.get("*/api/v1/admin/master/:slug", ({ params }) => HttpResponse.json(master[String(params.slug)] ?? [])),
  http.get("*/api/v1/members/number-series", () =>
    HttpResponse.json({
      items: [{ id: ids.series, prefix: "MSMC8", next_number: 9001, venue_id: null, property_id: null, to_be_confirmed: true }],
      default_id: ids.series,
    }),
  ),
  http.get("*/api/v1/admin/staff", () => HttpResponse.json([{ id: "u1", username: "demo.sales", full_name: "Demo Sales", roles: ["SALES"] }])),
  http.get("*/api/v1/auth/me", () =>
    HttpResponse.json({
      id: "u1", username: "demo.sales", full_name: "Demo Sales", roles: ["SALES"], permissions: ["member.view"], totp_enabled: false,
      must_change_password: false, must_enroll_totp: false, password_is_temporary: false, temp_password_expires_at: null, password_changed_at: null,
    }),
  ),
];

export const server = setupServer(...handlers);
