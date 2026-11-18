# Club8 CRM: Excel import and reports (prompt for Claude Code)

You are working on the existing Club8 CRM in this repository: FastAPI (Python 3.12, SQLAlchemy 2 async, Alembic, Pydantic v2), Next.js 15 App Router, PostgreSQL 16, Dramatiq worker, local stack in docker-compose. Read `docs/BUSINESS_RULES.md`, `docs/DATA_MODEL.md`, `docs/DECISIONS.md`, `docs/DESIGN_SYSTEM.md` and `docs/OPEN_QUESTIONS.md` before you start, and follow the conventions already in the code (TransactionalRoute, permission codes, audit log, money as Decimal with Indian grouping, dates in Asia/Kolkata, DD-MM-YYYY on screen).

Build two features: **A. Excel import** of existing members and their finance data, and **B. Reports and charts**. Digital signatures (eSign) and online payments (Razorpay) are **not** part of this task; they wait for Club8's answers.

## 0. Ground rules

- Work on a new branch `feature/import-and-reports` from `master`. If `fix/pdf-and-forms` is not merged yet, tell me before you start and wait.
- Fictitious data only, in templates, samples, tests, seed data and docs. Never real member data.
- Do not touch the `crm_local` database. Tests and demos use their own databases.
- Commit messages must not include any `Co-Authored-By` line or Claude session link.
- Aadhaar is stored masked only (last 4 digits). An import file containing a full 12-digit Aadhaar number is accepted only to mask it on the way in; the full number is never stored, logged or echoed back in an error sheet.
- Every money rule stays as it is: ASF + 5% GST on ASF only, currencies never added together, the entitlement ledger is the only source of nights.
- Before you write code, give me a short plan (data flow, new tables, new endpoints, new screens, open decisions) and wait for my OK.

## A. Excel import

### A1. What can be imported
One import "kind" per template, run in this order (later kinds refer to earlier ones by membership number):

1. **Members**: membership details and both applicants (names, DOBs, contacts, address, KYC IDs, brand/company, purchase date, tenure, first/last year of use, category, season, unit type, nights per year, consultant/RM/TM, total price, currency, status).
2. **Payment schedules**: EMI plan per member (instalment number, due date, amount, amount already paid).
3. **Payments (history)**: past payments with their original receipt numbers, dates, type, method, reference, base/GST/total.
4. **Entitlement opening balances**: per member per membership year, nights available, used, saved (with expiry year) and borrowed, as of a cut-over date.
5. **ASF years**: per member per year, raised/paid/not yet due, amount, GST, receipt number.
6. **Open reservations**: future bookings already confirmed, with status and nights held or deducted.
7. **Leads** (optional, can be run any time).

### A2. Templates
- An Admin screen **Import data** lists the kinds. Each has a **Download template** button producing an .xlsx with: one header row using plain-language column names, an "Instructions" sheet (what each column means, required or optional, allowed values, date format DD-MM-YYYY), dropdown validation for master-data columns (unit type, season, payment type, method, company), and two fictitious example rows.
- Allowed values in the template come from the live master data, so the template matches what the CRM accepts.

### A3. Upload, check, then import
1. **Upload** the filled .xlsx (or .csv). Store it in blob storage like other documents (virus scan included) and create an `import_batch` record (kind, file, uploaded by, status).
2. **Dry run** (always first, nothing written): parse every row, validate it and show a summary: rows OK, rows with errors, rows with warnings, and what would be created or updated. Errors are listed on screen and downloadable as an **error sheet**: the original rows plus an "Errors" column in plain language ("Row 14: PAN 'ABCDE1234' is not a valid PAN", "Row 22: unit type 'T3' doesn't exist").
3. Checks to include at minimum: required fields; dates and amounts parse; master-data values exist; PAN, mobile, email and pincode formats; duplicate members (same rules as the existing duplicate check: same PAN, or same name + DOB + mobile) both within the file and against the database; membership number unique and in the right prefix for the brand; payments add up (base + GST = total, GST only on ASF); instalments paid not more than due; entitlement balances not negative; references to members that don't exist.
4. **Import**: only allowed when the dry run has zero errors (warnings need a tick "I've checked the warnings"). Runs as a background job (Dramatiq), in one database transaction per batch, with progress on screen. Large files (say 20,000 rows) must work.
5. **Undo batch**: an administrator can roll back a whole batch while nothing else has been recorded against its records since; otherwise the button explains why it can't.

### A4. Rules for imported data
- **Keep existing numbers**: imported members keep their membership numbers; imported payments keep their original receipt numbers. The CRM's own sequences must start above the highest imported number per company and year so there is never a clash. Make the cut-over date a setting.
- **No side effects**: importing never sends emails, never generates receipt PDFs for historic payments (mark them "Imported, receipt issued outside the CRM"), never raises ASF and never sends default notices. Background jobs that would normally react to new records must skip imported history.
- **Entitlement**: opening balances go into the ledger as clearly labelled "Opening balance (import batch #N)" entries so every later movement still adds up.
- **Status**: imported members can come in as Active directly (they are existing members); the signed-agreement-upload check does not apply to them, but the member is flagged "Imported, agreement on paper file".
- **Audit**: every created record is logged in the activity log with the batch number; the batch itself records who uploaded, who imported, when, row counts and the file.
- **Permissions**: new permission `data.import`, given to ADMIN only by default. Undo needs ADMIN too.

### A5. Tests and sample files
- Backend tests for every check in A3, keep-numbers and sequence logic, no-side-effects, undo, and a 20,000-row performance test.
- A folder `samples/import/` with a fictitious filled template per kind, one clean and one with deliberate errors.
- A Playwright test: download template, upload the bad file, see the error sheet, upload the clean file, import, see the members, undo.

## B. Reports and charts

### B1. A Reports section
New left-menu item **Reports** (permission `report.view`; by default ADMIN, MANAGEMENT and FINANCE see all; a relationship manager or team manager sees only their own members). Every report has: a date-range picker with quick choices (this month, last month, this quarter, this half-year (Apr–Sep / Oct–Mar), this financial year (Apr–Mar), last financial year, custom); filters for company/brand, RM, TM and currency where relevant; totals at the bottom; **Export to Excel** and **Export to PDF** (PDF uses the branded document styling); and exports are logged in the activity log like other exports.

Reports to build:
1. **Outstanding ASF**: ASF raised but unpaid, for a date range (by date raised), by member, membership year, unit type and company, with ageing buckets 0–30, 31–60, 61–90, 90+ days, and the reservations each one is blocking.
2. **Pending and overdue payments**: EMIs due in the range and EMIs overdue as of the end date, by member, with amount due, paid, balance and days overdue; subtotals by RM/TM.
3. **Collections**: money received in the range by payment type (down payment, EMI, ASF, booking fee, upgrade, other), method and company, with base, GST and total separate.
4. **Sales performance**: new memberships in the range, count and value, by RM/TM, consultant, category and unit type; lead-to-member conversion for leads created in the range.
5. **Nights and reservations**: nights used, saved, borrowed and forfeited in the range; reservations by status; cancellations with nights returned; upcoming check-ins by resort.
6. **Default notices and terminations** issued in the range, with outcome.

### B2. Dashboard charts
On the home dashboard, above the existing action lists, add a compact **Performance** area for users with `report.view`:
- Headline figures for the chosen period with a comparison to the previous period (▲/▼ and %): collections, new memberships (count and value), outstanding ASF, overdue EMIs.
- A period switch: Monthly / Half-yearly / Yearly (financial year).
- Charts: collections by month (bar, by payment type), new memberships by month (bar or line), outstanding ASF by ageing bucket (bar), overdue EMIs trend (line).
- Each chart links to the matching report with the same filters.
- Use one small chart library (suggest Recharts) and the existing brand colours; every series also has a text label, never colour alone. Charts must work on a phone.

### B3. Performance and correctness
- Reports run as SQL aggregates, never by loading all rows into Python. Add indexes where needed (in an Alembic migration) and show me the query plans for the two heaviest reports on 50,000 fictitious members.
- Currencies are never summed together: show one total per currency.
- Every figure in a report must match the figures on the member screens. Write tests that build a small fictitious dataset and check each report's totals by hand-computed expected values.

## C. Housekeeping
- Add questions 35–46 to `docs/OPEN_QUESTIONS.md` under a new heading "New features (added 17-11-2026)", in the existing format with the current default in italics in square brackets:
  - 35 Existing records to migrate: how many, where kept; blanked sample file. [Not imported; exports only]
  - 36 Keep existing membership and receipt numbers; CRM numbering start date. [CRM issues new numbers]
  - 37 History to migrate: full payment and booking history or current balances only. [Not set]
  - 38 Regular imports after go-live (e.g. leads), or one-off. [No import]
  - 39 Electronic signatures (Aadhaar OTP eSign) instead of paper; lawyer's confirmation; stamp duty / e-stamp. [Scan of signed paper agreement required before approval]
  - 40 Authorised signatory for Club8/K8; does the co-applicant sign. [Not set]
  - 41 eSign provider already in use, or recommend one. [None]
  - 42 Reports used today; send examples. [Dashboard action lists; Excel exports]
  - 43 Who sees which reports. [Lists follow the user's role]
  - 44 Periods (financial year, half-years, quarters, months); targets. [Not set]
  - 45 Online payments by payment link, or offline only. [Staff record payments; no gateway]
  - 46 Razorpay/other gateway account; which payments online; who bears the fee. [None]
- Update `docs/USER_GUIDE.md` (Import data, Reports) and `docs/PROGRESS.md`.
- Run the full backend and Playwright suites; all must pass.

## D. Definition of done
- Plan approved by me before coding.
- Import: templates, dry run with error sheet, import, undo, keep-numbers, no side effects, tests and sample files, Playwright test, all passing.
- Reports: six reports with filters, totals and Excel/PDF export; dashboard performance area with charts; role-based visibility; totals tests; query plans shown.
- Docs updated; OPEN_QUESTIONS.md has 35–46.
- A short summary for me with screenshots of: the import dry-run result with errors, a successful import, the Outstanding ASF report, and the dashboard charts.
