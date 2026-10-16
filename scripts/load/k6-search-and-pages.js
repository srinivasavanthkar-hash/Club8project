// k6 load test: search < 1 s and page APIs < 2 s (p95) at 100k members / 1M payments.
// Prepare data with:  python scripts/load/generate_volume.py --members 100000 --payments-per-member 10
// Run:                k6 run -e BASE_URL=https://<front-door-host> -e USER=demo.manager -e PASS=... scripts/load/k6-search-and-pages.js
import http from "k6/http";
import { check, group, sleep } from "k6";

const BASE = __ENV.BASE_URL || "http://localhost:3000";

export const options = {
  scenarios: {
    staff: { executor: "ramping-vus", startVUs: 5, stages: [{ duration: "1m", target: 50 }, { duration: "3m", target: 50 }, { duration: "30s", target: 0 }] },
  },
  thresholds: {
    "http_req_duration{kind:search}": ["p(95)<1000"],
    "http_req_duration{kind:page}": ["p(95)<2000"],
    http_req_failed: ["rate<0.01"],
  },
};

export function setup() {
  const r = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify({ username: __ENV.USER, password: __ENV.PASS }), {
    headers: { "Content-Type": "application/json" },
  });
  check(r, { "logged in": (x) => x.status === 200 });
  const jar = http.cookieJar();
  return { cookies: jar.cookiesForURL(BASE) };
}

const QUERIES = ["90", "MSMC8-1", "Test Member 4", "98450", "@example.com", "L-2026-0001"];

export default function (data) {
  const jar = http.cookieJar();
  for (const [k, v] of Object.entries(data.cookies)) jar.set(BASE, k, v[0]);
  group("search", () => {
    const q = QUERIES[Math.floor(Math.random() * QUERIES.length)];
    const r = http.get(`${BASE}/api/v1/search?q=${encodeURIComponent(q)}`, { tags: { kind: "search" } });
    check(r, { "search 200": (x) => x.status === 200 });
  });
  group("pages", () => {
    const list = http.get(`${BASE}/api/v1/members?page_size=25&status=ACTIVE`, { tags: { kind: "page" } });
    check(list, { "members 200": (x) => x.status === 200 });
    const items = list.json("items") || [];
    if (items.length) {
      const id = items[Math.floor(Math.random() * items.length)].id;
      for (const p of [`/members/${id}`, `/members/${id}/payments`, `/members/${id}/finance-summary`, `/members/${id}/entitlement`, `/members/${id}/timeline`]) {
        check(http.get(`${BASE}/api/v1${p}`, { tags: { kind: "page" } }), { [`${p} 200`]: (x) => x.status === 200 });
      }
    }
    check(http.get(`${BASE}/api/v1/dashboard`, { tags: { kind: "page" } }), { "dashboard 200": (x) => x.status === 200 });
  });
  sleep(1);
}
