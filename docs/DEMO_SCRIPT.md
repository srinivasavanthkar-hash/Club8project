# Initial delivery demo (Section 14), click by click

All data is **fictitious**. The same flow runs automatically in CI as:
* `backend/tests/integration/test_demo_flow.py` (API level, via `app/demo_scenario.py`)
* `frontend/e2e/demo.spec.ts` (Playwright through the UI)

## Setup (fresh environment)
```bash
docker compose up -d --build
bash scripts/seed-demo.sh --no-scenario     # migrations + reference data + DEMO rates/users
```
Open http://localhost:3000. All demo users share the password `Demo-Passw0rd!` (override with `CRM_DEMO_PASSWORD`).

| Step | Sign in as | Clicks | What to show |
|---|---|---|---|
| 1a | `demo.sales` | **Leads → New lead**. Name "Kiran Demo", mobile 98xxxxxxxx, email, city Bengaluru, OPC "Demo OPC". **Save lead** | Lead ID `L-2026-…` and status NEW |
| 1b | | On the lead: **CONTACTED** → enter a presentation date and time → **PRESENTATION SCHEDULED** → **ATTENDED** | Status history at the bottom |
| 1c | | **Convert to member**. The form is pre-filled. Complete it in paper-form order: DOB, PAN, address, PIN, state; company CLUB8; **Premium / Red / T0 Studio / 7 nights / 10 years**; price 2,50,000, admin fees 5,000, down payment 55,000 **by Card** (reference, last 4 = 4242); balance mode **EMI**: 20,000 × 10 from next month; tick signatures. **Create member & convert lead** | Member `MSMC8-…`, PENDING APPROVAL. Total ₹2,55,000.00, balance ₹2,00,000.00, last year calculated. Open the lead: it is **CONVERTED** and linked ("Open member") |
| 2 | `demo.sales` | *Correspondence & Documents* → type "Membership Agreement (signed)" → choose a PDF | Document listed |
| 2 | `demo.manager` | *Profile* → approval panel says "All checks passed" → **Approve member** | Status ACTIVE; *Entitlement* tab now shows 7 nights for each of the 10 years |
| 3 | `demo.finance` | *Finance*: the down payment (Card ••••4242) and its **Receipt** are listed. **Generate EMI schedule** → 10 instalments. **Record payment** → Membership EMI, 20,000, UPI, reference → Save | Instalment 1 PAID; a receipt PDF opens from the ledger; GST shown only on ASF |
| 4 | `demo.reservations` | *Reservations → New reservation*: Goa → Demo Beach Resort (Premium); dates ~3 weeks ahead, 4 nights | The live calculation shows **4 entitlement nights from this year** and **ASF payable ₹12,600.00 incl. GST** (₹12,000 DEMO rate + 5%). **Submit request** |
| 5a | | Open the reservation: "ASF unpaid" warning. **Approve (deduct entitlement)** → confirmation number → **Confirm** | Red alert: "ASF unpaid … non-payment of ASF results in non-confirmation" |
| 5b | `demo.finance` | *Finance* → ASF table → **Pay ASF 2026** → Card, reference → Save | ASF year PAID with receipt number |
| 5c | `demo.reservations` | Reservation → enter confirmation no. → **Confirm** | CONFIRMED. *Entitlement*: used 4.0, remaining 3.0. Clicking Approve again is not possible (deducted exactly once; the ledger shows a single DEDUCTION) |
| 5d | | New reservation, same year, 2 nights | "ASF payable: none (already raised for these years)" |
| 6 | `demo.service` | *Correspondence*: add an email (subject "Early check-in request") and a call (summary "Welcome call") | Email thread and call listed; both on the timeline |
| 7 | | Upload a PDF ("Other") → **Preview** | Inline viewer opens (short-lived signed URL) |
| 8 | `demo.manager` | *Profile → Edit* → change comments, reason "Welcome call" → Save. Then the *History* tab (or **Activity log** filtered by member) | Every step above: lead created, status changes, conversion, upload, approval, payments, schedule, ASF raised, entitlement deducted, reservation status changes, email, call, upload, and the edit with **old → new values**. **Verify integrity** shows the hash chain intact |

## Passwords and account access (Phase 1)
| Step | Sign in as | Clicks | What to show |
|---|---|---|---|
| 9a | (anyone) | Sign-in page: type a password, click the eye | Show/hide; Caps Lock hint; hides again after Sign in |
| 9b | `demo.admin` | **Admin → New user** (username, name, roles) → **Create user** | No password field. Temporary password shown once, with Copy; expires in 24 h |
| 9c | the new user (2nd browser) | Sign in with the temporary password | Only **Choose a new password** is reachable. Checklist + strength meter. `password1234` is refused as breached |
| 9d | `demo.admin` | User row → **Reset password…** → reason | Temporary password once; the user's open session ends at once ("Your session ended") |
| 9e | the user | User menu → **Change password** | "Sign out of all other devices" ticked by default |
| 9f | `demo.admin` + a 2nd admin | Reset another ADMIN → the 2nd admin approves in "Administrator resets waiting for approval" | Two-person rule; all steps in the activity log |
| 9g | `demo.admin` | **Reset 2FA…** on a user with 2FA | The user must set up 2FA again (QR code) at next sign-in; password unchanged |

Automated with screenshots: `TOUR=1 python scripts/run_e2e.py passwords --project=desktop` (fresh throwaway
database; the specs that write data refuse to run against the demo).

`demo.admin` signs in with two-step verification. Add the FICTITIOUS demo key `DEMOADMINTWOFACTORKEY234` to an
authenticator app ("Enter a set-up key") to get the codes.

## Automated run against a running stack
```bash
docker compose run --rm api python -m app.demo_cli --base-url http://web:3000
cd frontend && E2E_BASE_URL=http://localhost:3000 npx playwright test
```

## Illustrated walkthrough for clients
`docs/demo-tour/index.html` is the same flow with screenshots, written for the client (open it in a browser). To retake
the screenshots after UI changes, run against a freshly seeded stack:
```bash
TOUR=1 python scripts/run_e2e.py tour --project=desktop   # fresh throwaway database; writes docs/demo-tour/*.png
```
