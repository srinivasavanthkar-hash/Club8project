# Club8 CRM: next phase (fixes, membership prefixes, record-level access, import and reports, reminders, suppliers and web leads, supplier API)

You are working on the existing Club8 CRM in this repository (FastAPI + SQLAlchemy 2 async + Alembic, Next.js 15, PostgreSQL 16, Dramatiq worker with the APScheduler-style scheduler in `app/jobs/scheduler.py`, docker-compose local stack with Mailpit). Read `docs/BUSINESS_RULES.md`, `docs/DATA_MODEL.md`, `docs/DECISIONS.md`, `docs/DESIGN_SYSTEM.md`, `docs/OPEN_QUESTIONS.md` and `docs/PROGRESS.md` first, and follow the conventions already in the code.

This prompt has **seven phases** (Phase 7 starts only when I say so). Do them **in order, one branch per phase**, each merged into `master` only after its tests pass and I have said OK. At the start of each phase, give me a short plan (what changes, new tables/endpoints/screens, open decisions) and wait for my OK before writing code. At the end of each phase, give me a short report with screenshots.

## Ground rules (all phases)

- Fictitious data only, in seed data, tests, samples, screenshots, videos and docs. Never real member data.
- Do not touch the `crm_local` database.
- Commit messages must not include any `Co-Authored-By` line or Claude session link.
- Aadhaar is stored masked only (last 4 digits), never logged or echoed.
- Money rules stay as they are: ASF + 5% GST on ASF only; currencies never added together; the entitlement ledger is the only source of nights.
- Times and dates in Asia/Kolkata; DD-MM-YYYY on screen; Indian digit grouping for INR.
- Every new action that changes data is written to the activity log.
- Before starting Phase 1: check that `feature/demo-clips` is merged into `master` (merge it if not), and push `master` to `origin` so CI runs. Tell me the CI result.

---

## Phase 1: fixes (branch `fix/pdf-and-forms`)

1. **Branded PDFs, no silent fallback.** Receipts, default notices, vouchers and cancellation letters currently fall back to plain text on Windows (no logo, "Rs." instead of ₹, raw codes like `DOWN_PAYMENT`). Make PDF generation run inside the Docker stack (WeasyPrint in the api/worker image) so it works the same everywhere. Remove the silent fallback: if the PDF engine can't run, fail loudly with a clear error and a health-check warning, never produce a plain-text document. Show human labels (Down payment, EMI, ASF…) and ₹ with Indian grouping. Add tests that render each document type and check the logo, ₹ and labels are present.
2. **Default-notice PDF viewer is blank.** In the money clip at about 1:24 the notice opens in the PDF viewer as an empty dark box for 6+ seconds. Make the notice render (it is probably the same fallback as item 1), and make the viewer show a loading state, then the document, or a clear error.
3. **Booking fee linked by pasting a reservation ID.** Replace with a dropdown of the member's reservations (number, resort, dates, status), searchable, with "none" allowed.
4. **Master data entered as raw JSON.** Replace with proper forms for ASF and tax rates, the night-deduction matrix, cancellation tiers and the season calendar: dropdowns for related records (show names, never UUIDs), date pickers, validation messages in plain language, and tables that show names instead of IDs. Club8 will enter their real data here.
5. **React hydration error #418** on the activity log. Likely server/client date formatting; format dates in Asia/Kolkata consistently on both sides. Add a Playwright check that the page loads with no console errors.
6. **Demo data and clips.**
   - DEMO night-deduction matrix: make an upgrade cost more nights than the purchased tier so the upgrade in clip 1 doesn't look free.
   - Clip 1: show the 2027 balance at the end.
   - Clip 2: after the booking-fee reversal, record and show the corrected ₹2,000 entry.
   - Fix the caption that is missing its full stop.
   - Re-record the main video and all three clips once items 1–6 are done, and run the QC checks (main ≤ 6:30, clips 1:30–3:15 and < 50 MB, captions ≥ 2.5 s, yuv420p limited range).
7. Add `*.egg-info/` to `.gitignore` and remove the tracked `club8_crm.egg-info` folder from git.

## Phase 2: membership number prefixes by location/property (branch `feature/membership-prefixes`)

Club8 answered open question 1: **the membership-number prefix depends on the location and the property**, not only the brand. Prefixes seen so far: `MSMBL`, `MSMC8`, `C8MPR`, `C8MTHN`. Today each company has a single `membership_prefix` (`admin/models.py`), and the number is built as `{company.membership_prefix}-{seq}` in `members/service.py`.

- Make prefixes master data: a **Membership number series** table (company, location/property it applies to, prefix, next number, active from/to), editable in Admin with a proper form.
- On the member form, the series is chosen from the member's company and location/property (dropdown, defaulted where only one fits). The number is generated from that series; staff can still type the number part for existing paper members, with the duplicate check.
- Search keeps working by the number part alone, and by the full number with any prefix.
- Migrate existing members without changing their numbers. Seed the four prefixes above as fictitious examples linked to demo properties, marked "to be confirmed".
- Update open question 1 in `docs/OPEN_QUESTIONS.md`: answered in part; follow-up needed for which prefix belongs to which location/property, and K8's prefixes.

## Phase 3: record-level access (branch `feature/record-access`)

Roles and permissions already decide **what** a user can do. Nothing yet limits **which records** they can see: anyone with `member.view` sees every member, and anyone with `export.run` exports everything. Add record-level access, enforced on the server, so reports and exports (Phase 4) build on it.

- **Scope per role, set in Admin → Users & roles:** `All records`, `Own company only`, `Own team` (members whose team manager is the user, or who belong to the user's team), `Own records only` (members and leads where the user is the relationship manager/salesperson). Defaults until Club8 answers: Administrator, Management, Finance, Reservations and Member services = All records; Sales and Marketing = All records too (no behaviour change), with the setting ready to switch.
- **Company assignment per user:** a user can be linked to one or more companies (Club8, K8). With `Own company only`, they see only those companies' members, leads, payments, reservations and documents.
- **One rule, applied everywhere:** a single scoping function used by every list, search, dashboard widget, member page and its tabs, related records (payments, reservations, documents, correspondence), exports and reports. Opening a record outside the user's scope returns "not found", not "forbidden", so its existence isn't revealed.
- **Hand-overs:** when a member's relationship manager changes, the new RM sees the member at once and the old one no longer does; the change is in the activity log. Management can reassign members in bulk.
- **Exports:** add `export.all` (export beyond the user's own scope), ADMIN and MANAGEMENT by default; other users' exports follow their scope.
- **Tests:** for every scope, a user sees exactly the right members across list, search, member page, tabs, dashboard and export, and gets "not found" for others. A Playwright test signs in as a Sales user set to `Own records only` and checks the member list and search.
- Add open questions 54–56 to `docs/OPEN_QUESTIONS.md` under "Who can see which records (added 17-11-2026)":
  - 54 Should sales staff and RMs see only their own members and leads, and TMs only their team's? [All records; switchable per role]
  - 55 Do some staff work only for Club8 or only for K8, and should they see only that company? [All staff see both companies]
  - 56 Who may export the full member and payment lists? [ADMIN and MANAGEMENT; others export within their scope]

## Phase 4: Excel import and reports (branch `feature/import-and-reports`)

Follow **`docs/IMPORT_REPORTS_PROMPT.md`** in full (sections A–D). The import must use the membership number series from Phase 2 and keep Club8's existing numbers. Reports and dashboard charts must use the record-level scoping from Phase 3 (that replaces the simpler "RM/TM sees only their own members" rule in that prompt). Section C there also adds open questions 35–46.

## Phase 5: reminders and notifications (branch `feature/reminders`)

Today the CRM sends no messages to members. The only emails are staff password-reset and security notices (`app/email/templates`). Scheduled jobs exist for overdue instalments, saved nights, membership expiry, scan results and password resets, but none sends anything. Build reminders so that **email works now**, and **WhatsApp and SMS are ready to switch on** once Club8 chooses providers.

### 5.1 Reminders to build

| # | Reminder | To | When (defaults, configurable) |
|---|---|---|---|
| 1 | EMI due soon | Member | 7 days and 1 day before the due date |
| 2 | EMI overdue | Member | 3 and 7 days after the due date |
| 3 | Unpaid ASF holding up a booking | Member | When the ASF is raised, then every 3 days until paid or the booking is cancelled/declined |
| 4 | Default-notice deadline | Member | When the notice is issued, then 7 and 2 days before the 14-day deadline |
| 5 | Check-in reminder | Member | 7 days and 1 day before check-in |
| 6 | Daily staff digest | Finance users and each RM/TM | Every working morning at 08:30 IST: their own overdue EMIs, unpaid ASF, default notices expiring within 7 days, reservations waiting for approval |

Plus one **staff alert**: when a default notice's 14-day deadline passes unpaid, email Finance and Management that the member is due for termination review (termination itself stays manual).

### 5.2 How it works

- **Scheduler:** a new daily job `send_due_reminders` (e.g. 09:00 IST) and `send_staff_digest` (08:30 IST, working days only, using the holiday calendar), added to `SCHEDULE` in `app/jobs/scheduler.py`. Event reminders (ASF raised, notice issued) are queued when the event happens.
- **Idempotent:** a `notification` table records every message (member, kind, related record such as instalment/reservation/notice, channel, scheduled date, status queued/sent/failed/skipped, provider message id, error). A unique key on (kind, related record, offset, channel) guarantees nothing is ever sent twice, even if a job runs again or two workers race.
- **Stops by itself:** before sending, re-check the condition (instalment still unpaid, ASF still unpaid, booking still active, notice still open). If not, mark it skipped.
- **Channels behind one interface:** `NotificationChannel` with `EmailChannel` (existing email sender: Mailpit locally, Azure Communication Services in Azure), `WhatsAppChannel` and `SmsChannel`. WhatsApp and SMS get a **console/fake provider** for local and tests, plus a provider adapter interface ready for a real provider (Gupshup, Interakt, MSG91 or Twilio for WhatsApp; a DLT-registered SMS provider). **Do not sign up for or call any real provider.** Settings and Key Vault secret names for provider credentials are documented but empty.
- **Templates as master data:** Admin → **Message templates**: per reminder kind and channel, editable subject/body with placeholders (member name, membership number, amount with ₹ and Indian grouping, due date, resort, dates, confirmation number, company name and contact). Preview with fictitious data. Per company/brand (Club8 and K8 wording and logos). WhatsApp templates carry the provider template name and approval status; SMS templates carry the DLT template ID and sender ID. A channel/template that isn't approved is never used.
- **Payment link placeholder:** templates support an optional `{payment_link}` placeholder that is left out (with its sentence) until online payments exist.
- **Member preferences and consent:** on the member profile, per channel: allowed yes/no, preferred channel, and the consent date/source for WhatsApp and SMS. Opt-out stops that channel at once. Members with no email/mobile are skipped and listed in the digest.
- **Logged:** every sent message appears on the member's **Correspondence** tab (channel, time, text sent, status) and in the activity log.
- **Controls:** Admin → **Reminders** settings: on/off per reminder kind and per channel, the day offsets, send times, a **pause all** switch, and a "send test to me" button. Defaults: all reminder kinds on for email; WhatsApp and SMS off.
- **Quiet hours:** member messages only go out between 09:00 and 20:00 IST; anything due outside that waits.
- **Failures:** retries with backoff; after the last retry, status "failed" and it shows on a **Notifications** admin screen (filter by status, kind, channel, date; resend a failed one).
- **Permissions:** `notification.view` (Finance, Management, Admin), `notification.manage` (Admin) for settings and templates.

### 5.3 Tests and demo

- Backend tests for each reminder kind: sends on the right day, never twice, skips when paid/cancelled, respects opt-out, quiet hours and pause, uses the right company's template.
- A time-travel test helper (freeze "today") so the schedule can be tested without waiting.
- Playwright: edit a template, see the preview, trigger the job for a fictitious member with an EMI due tomorrow, see the email in Mailpit and the entry on the Correspondence tab.
- Seed demo data so each reminder kind fires at least once in the demo.

### 5.4 Questions for Club8

Add these to `docs/OPEN_QUESTIONS.md` under a new heading "Reminders and notifications (added 17-11-2026)", in the existing format with the default in square brackets:

- 47 **Channels.** Which channels should member reminders use: email, WhatsApp, SMS? [Email only until WhatsApp/SMS providers are chosen]
- 48 **Timing.** Are the reminder days right (EMI 7 and 1 days before, 3 and 7 days after; ASF every 3 days; notice 7 and 2 days before the deadline; check-in 7 and 1 days before)? [As listed]
- 49 **Wording.** Who approves the message wording, especially for default notices? Should reminders be in English only or also in other languages? [English; wording to be approved]
- 50 **Staff digest.** Who should get the daily digest, and at what time? [Finance and each RM/TM, 08:30 IST, working days]
- 51 **WhatsApp.** Do you have a WhatsApp Business account or provider? Which number should messages come from? [None]
- 52 **SMS.** Is Club8 registered on DLT, with a sender ID and approved templates? [None]
- 53 **Consent.** How is a member's consent to WhatsApp/SMS messages recorded today (e.g. a tick box on the application form)? [Consent recorded in the CRM by staff]

Update `docs/USER_GUIDE.md` (Reminders, Message templates, Notifications) and `docs/PROGRESS.md`.

---

## Phase 6: partner-hotel supplier records and website leads (branch `feature/suppliers-and-web-leads`)

Club8 books rooms for members at partner hotels through **TravClan** and **RezLive** (both B2B hotel wholesalers), and its public website runs on **Wix**. This phase needs nothing from the suppliers or Wix to build; it is tested with fictitious data and a simulated form submission.

### 6.1 Supplier booking records (no supplier API yet)

Staff keep booking on the supplier's website; the CRM records each booking properly.

- **Supplier master data:** a `supplier` table (name, type: B2B wholesaler / hotel direct / other, active, contact, notes), edited with a proper form in Admin. Seed TravClan, RezLive, "Direct with hotel" and "Other".
- **Supplier panel on a reservation** (a reservation can have one or more supplier bookings, e.g. multi-room): supplier, supplier booking reference, hotel name as booked, city, room type, meal plan, check-in/out, rooms, cost price (amount, currency, tax included yes/no), supplier free-cancellation deadline, supplier cancellation charge if known, supplier payment status (Paid from wallet / On credit / Pending), supplier voucher upload, notes.
- **Rules:** supplier reference unique per supplier (duplicate blocked with a clear message); dates must match the reservation (warning if not); a reservation marked "partner hotel" without a supplier booking shows a "Supplier details missing" badge and appears in a to-do list.
- **The member never sees** supplier name, reference or cost on any member-facing document (vouchers, letters, emails); Club8's own voucher stays as it is.
- **Permissions:** `supplier.view_cost` (Finance, Management, Reservations, Admin) to see cost prices and margins; `supplier.manage` (Reservations, Admin) to add/edit supplier bookings; `admin.suppliers` for the master list. Sales and others see that a supplier booking exists but not the cost. Respect Phase 3 record-level scoping.
- **Cancellation safety net:** when a reservation with a supplier booking is cancelled, show the supplier free-cancellation deadline next to the member's notice outcome, and create a task "Cancel with TravClan by DD-MM-YYYY" assigned to the reservations team; flag it red on the dashboard if the deadline is within 2 days and the supplier booking is still active. Staff record "cancelled at supplier" with the supplier's cancellation reference and any charge.
- **Search:** the global search finds a reservation by supplier booking reference.
- **Reports** (in the Phase 4 Reports section, same filters, scoping and Excel/PDF export):
  1. *Partner-stay margin:* per reservation and totals by destination, supplier and month: cost price vs what the member was billed (upgrade/extra-night fees; nights deducted shown separately, as nights).
  2. *Supplier spend:* by supplier, month and destination; paid vs on credit vs pending.
  3. *Supplier reconciliation:* upload the supplier's statement (Excel/CSV; let the user map columns once per supplier and remember the mapping), match on supplier reference, and list: in statement but not in the CRM, in the CRM but not in the statement, and amount or date mismatches.
  4. *Supplier cancellation deadlines:* upcoming deadlines for cancelled or at-risk bookings.
- **Activity log** for every supplier booking create/edit/cancel.
- **Tests:** duplicate reference, permission hiding of cost, member documents never showing supplier data, cancellation task and deadline warning, each report's totals against hand-computed values, reconciliation with a fictitious statement containing deliberate mismatches.
- Design the supplier booking model so Phase 7 can fill the same fields automatically from the supplier APIs (add `source`: manual / api, and `supplier_hotel_id`, `supplier_room_code`, `raw_response_ref` as nullable fields now).

### 6.2 Website enquiries from Wix into CRM leads

- **Endpoint:** `POST /api/public/web-leads` in the API, the only public route besides login. It accepts a JSON form submission, is authenticated with a **shared secret** sent in a header (stored in Key Vault, rotatable, compared in constant time), rate-limited, size-limited, and logs every call (without storing the secret).
- **Mapping:** name, mobile, email, city, message, form name, page URL, UTM source/campaign if present, consent tick if present. Creates a lead with source **Website**, status New, entry date = submission time (Asia/Kolkata), the form name and message in the lead notes, and runs the existing duplicate check: a probable duplicate is still saved but flagged for review, and linked to the existing lead or member.
- **Idempotent:** Wix may retry; a submission ID (or a hash of form + fields + minute) prevents duplicates.
- **Routing and alerts:** an assignment rule in Admin (by form name and/or city → salesperson or a round-robin pool), and an email to the assignee and to a configurable "web leads" address when a lead arrives. These emails use the Phase 5 notification system and templates.
- **Admin screen "Website leads":** shows the endpoint URL, a button to generate/rotate the secret (shown once), the last 50 calls with status, and a **"Send test lead"** button that posts a fictitious submission.
- **Setup guide for Club8:** add a section to `docs/USER_GUIDE.md` explaining, step by step with screenshots placeholders, how a Wix site admin connects each form (Wix Automations: trigger "form submitted", action "send HTTP request"/webhook to the endpoint URL, with the secret header and the field mapping). Note that the exact Wix menu names should be checked against Wix's current help pages when they set it up, and that the action may depend on their Wix plan.
- **Security:** the endpoint never returns lead data; it answers only accepted / rejected. Reject submissions without a mobile or email. Strip HTML. Add it to the Front Door/WAF routing in Terraform as a separate path with its own rate limit (Terraform change only; no deployment).
- **Tests:** valid submission creates a lead; wrong/missing secret rejected; retry doesn't duplicate; duplicate detection; rate limit; routing rule; alert email visible in Mailpit; Playwright test of the "Send test lead" button.

### 6.3 Questions

Add these to `docs/OPEN_QUESTIONS.md` under "Partner hotels and website (added 18-11-2026)":
- 57 B2B portals used for partner-hotel bookings. **Answered:** TravClan and RezLive.
- 58 Monthly volume through these portals vs own resorts. [Not tracked]
- 59 API access, and recording supplier/reference/cost. **Partly answered:** Club8 has API access to both; API documentation and test (sandbox) credentials still needed, shared securely.
- 60 Which website forms should feed the CRM, and who is alerted. [Not connected; staff retype web enquiries]
- 61 Who manages the Wix site and which plan; someone with admin access for about an hour to connect the forms. [Not connected]

## Phase 7: TravClan and RezLive API link (branch `feature/supplier-api`), starts only when I say so

**Do not start this phase until I give you the API documentation and test (sandbox) credentials.** Never put credentials in code, commits, logs, chat or docs: local `.env` (git-ignored) for development, Key Vault in Azure. Use only the suppliers' test environments; never make a live booking.

When it starts, begin with a plan based on the documentation, covering:
- **Adapter design:** one `SupplierAdapter` interface (search, price check, book, get booking, cancel, get voucher, get statement if offered) with one implementation per supplier, plus a fake adapter for tests and demos. Start with the supplier Club8 uses more (open question 58); the second follows the same interface.
- **Staff flow, inside a member's reservation:** search by destination, dates, rooms and guests → results from the connected suppliers side by side (hotel, room, meal plan, cost, cancellation terms) → price recheck before booking, showing any change → **Book** fills the Phase 6 supplier booking (`source = api`), deducts nights through the normal reservation rules and issues Club8's voucher → supplier voucher fetched and filed. **Cancel** on the reservation offers to cancel at the supplier, showing the supplier charge first.
- **Never lose a booking:** write a "booking attempt" record (with a unique client reference sent to the supplier) *before* calling book; if the call times out or the CRM fails afterwards, a recovery job looks the booking up by that reference and either completes the CRM record or flags it for staff. A nightly reconciliation job compares the CRM with each supplier's booking list/statement and reports mismatches.
- **Hotel matching:** how the same hotel is recognised across both suppliers (supplier IDs, name + geo + address matching, a manual mapping table for corrections).
- **Limits and failures:** timeouts, retries only where the supplier says a call is safe to repeat, rate limits, supplier downtime (search shows the other supplier and a notice), clear error messages for staff.
- **Money:** whether API bookings draw on the same wallet/credit limit as website bookings (open question for Club8), currency handling, and that cost prices remain visible only to permitted roles.
- **Logging:** every supplier call logged with timing and outcome (no credentials, no full card or personal ID data); every booking and cancellation in the activity log.
- **Tests:** contract tests against recorded sandbox responses, the fake adapter for the full flow in Playwright, and the failure cases above (timeout after booking, price change, sold out, cancellation charge).

---

## Not in this prompt (waiting for Club8)

- **Digital signatures (eSign)** for the application and agreement: waits for the lawyer's confirmation, stamp-duty answer and Club8's provider account (open questions 39–41).
- **Online payments (Razorpay)**: waits for Club8's decision and merchant account (open questions 45–46). Phase 5's `{payment_link}` placeholder is the hook for it.
- **Azure deployment**: waits for Club8's subscription. Before go-live, also move to Node 22 LTS (noted in PROGRESS.md).

## Definition of done (each phase)

- Plan approved before coding.
- Backend and Playwright suites pass, including the new tests; CI green on `origin`.
- Docs updated (USER_GUIDE, PROGRESS, OPEN_QUESTIONS where stated).
- Branch merged into `master` after my OK.
- A short report with screenshots. For Phase 1 also the re-recorded videos with the QC results; for Phase 5 a screenshot of a reminder email in Mailpit and the Correspondence tab entry.
