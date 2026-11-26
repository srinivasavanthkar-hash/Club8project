# Club8 Holidays / K8 — Cloud CRM

CRM for the CLUB8 Holidays / K8 holiday-membership business (Multiple Sales and Marketing LLP). It covers
street leads, member applications (mapped field-by-field to the paper form), finance (EMIs, ASF + GST, receipts,
default notices), reservations with an entitlement ledger (save/borrow, deduction matrix, cancellation tiers),
correspondence and documents, and a tamper-evident activity log.

| | |
|---|---|
| Backend | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 (async), Alembic, PostgreSQL 16, Dramatiq + Redis |
| Frontend | Next.js 15 (App Router, TypeScript strict), TanStack Query/Table, React Hook Form + Zod, Tailwind |
| Cloud | Azure Container Apps, PostgreSQL Flexible Server, Blob Storage, Key Vault, Redis, Front Door + WAF, Application Insights (Terraform `azurerm`) |

## Documentation
[Plan](docs/PLAN.md) · [Architecture](docs/ARCHITECTURE.md) · [Data model](docs/DATA_MODEL.md) ·
[Form mapping](docs/FORM_MAPPING.md) · [Business rules](docs/BUSINESS_RULES.md) · [Decisions](docs/DECISIONS.md) ·
[Open questions](docs/OPEN_QUESTIONS.md) · [Backup & restore runbook](docs/BACKUP_RESTORE_RUNBOOK.md) ·
[User guide](docs/USER_GUIDE.md) · [Demo script](docs/DEMO_SCRIPT.md) · [Client walkthrough](docs/demo-tour/index.html) · [OpenAPI](docs/openapi.json) ·
[Design system](docs/DESIGN_SYSTEM.md) · [Design decisions](docs/DESIGN_DECISIONS.md) · [UI audit](docs/ui-audit/AUDIT.md) ·
[Brand prompt](docs/BRAND_PROMPT.md)
(live at `/api/v1/docs` outside prod)

## Run locally with Docker
```bash
docker compose up -d --build                # postgres, redis, azurite, api, worker, scheduler, web
bash scripts/seed-demo.sh                   # migrate + DEMO master data/users + run the Section 14 demo scenario
# open http://localhost:3000 — users demo.admin / demo.manager / demo.sales / demo.finance /
# demo.reservations / demo.service / demo.marketing, password Demo-Passw0rd!
# demo.admin also asks for a 2FA code: add the FICTITIOUS demo key DEMOADMINTWOFACTORKEY234 to an authenticator app
```
`docker compose --profile scan up -d clamav` and `CRM_VIRUS_SCAN_PROVIDER=clamav` enable local virus scanning.
If port 5432 is already taken (e.g. by a system PostgreSQL), put `CRM_PG_HOST_PORT=5434` in a `.env` file next to
`docker-compose.yml` (git-ignored); only tools on the host use that port, the services talk to `postgres:5432` inside.

## Run locally without Docker (Windows/macOS/Linux)
The API and the worker need the PDF engine (WeasyPrint with Pango) and **refuse to start without it**: receipts,
notices, vouchers and letters are never produced as plain text. Docker images include it. On a machine without
Pango (e.g. Windows without GTK) run the backend with Docker (above); the frontend and the database can still run
directly. Backend *tests* use a marked test stub instead (`CRM_PDF_ENGINE=test_stub`, set in `tests/conftest.py`;
refused in staging and prod).
```bash
python -m venv .venv && .venv/Scripts/pip install -e "backend[dev]" pgserver   # (bin/ on macOS/Linux)
python scripts/local_db.py --name crm_local        # embedded PostgreSQL 16: DROPS and re-creates crm_local (DEMO data); prints the URL
python scripts/local_db.py --name crm_local --no-reset   # later: just start its server and print the URL (keeps your data)
# crm_local has its own server folder (.local/club8-crm-pgserver), started only by the two commands above. Every other
# database (e2e, demo video, test fallback) uses the scratch server in .local/club8-crm-pgserver-scratch.
cd backend && CRM_DATABASE_URL=<printed url> CRM_BLOB_PROVIDER=memory CRM_VIRUS_SCAN_PROVIDER=none \
  CRM_COOKIE_SECURE=false uvicorn app.main:app --port 8000
cd frontend && npm ci && npm run build && npm start   # http://localhost:3000, proxies /api/v1 to :8000
# Emails (password reset, notices): Mailpit catches them. Docker: the `mailpit` service (http://localhost:8025).
# Without Docker: unzip mailpit-windows-amd64.zip (github.com/axllent/mailpit, v1.32.0) into .local/mailpit/ and run
#   .local/mailpit/mailpit.exe --smtp 127.0.0.1:1025 --listen 127.0.0.1:8025   (the API's default SMTP is :1025)
```

## Tests
```bash
cd backend
ruff check app tests alembic && mypy app
pytest --cov=app                 # unit + integration (real PostgreSQL via testcontainers, or pgserver, or CRM_TEST_DATABASE_URL)
sh ../scripts/test-pdf-render.sh # PDF rendering tests with the real engine, in the backend image (skipped above without Pango;
                                 # CI installs Pango and fails if they cannot run)
cd ../frontend
npm run lint && npm run typecheck && npm test   # lint includes the design-token check
npm run check:contrast           # WCAG AA contrast of the colour tokens
cd .. && python scripts/run_e2e.py   # Playwright on a THROWAWAY stack (Docker: fresh crm_e2e database and the API from
                                     # the backend image; frontend on the host, :8001/:3001):
                                     # Section 14 demo, passwords, axe a11y, visual regression. Specs that write data
                                     # refuse to run against any stack that isn't flagged CRM_E2E_TARGET (the demo).
```
**Fixed "today".** Results that depend on the date (year-end rules, booking lead times, overdue instalments) must not
change as the calendar moves, so tests run on a fixed business date, **16-11-2026** (a Monday):
- backend tests: `CRM_FIXED_TODAY=2026-11-16`, set in `backend/tests/conftest.py`;
- e2e stacks (`scripts/run_e2e.py`, CI): the API runs with `CRM_FIXED_TODAY`, the demo scenario included, and
  `/api/v1/meta` reports the date. Specs import `test` from `frontend/e2e/support/clock.ts`, which sets each page's
  clock to that date (keeping the real time of day) and gives `istToday()` / `stay()` for dates worked out in the
  spec. `requireIsolatedStack()` refuses a stack on another date.

It moves only the business date (`today_ist()`). Event timestamps, sign-in tokens, lockouts, reset links and two-step
codes keep the real clock. The setting is refused in staging and production. Work out dates from `today_ist()` (backend)
or `istToday()` (specs), never from the system clock. To move the date, change it in `conftest.py`, `run_e2e.py`
(`E2E_TODAY`), `clock.ts` and `ci.yml` together.

Status at hand-over: 110 backend tests passing (65 unit/property tests + 45 integration tests on PostgreSQL 16,
including the full Section 14 demo); 90% coverage on the service + domain layer (CI gate: 80%); ruff and mypy clean;
13 frontend unit tests; the Playwright Section 14 demo passing against a live stack; Terraform `validate` passing
for dev/staging/prod.

Load testing: `scripts/load/generate_volume.py` (100k members / 1M payments, fictitious) +
`scripts/load/k6-search-and-pages.js`. Measured results are in [Architecture](docs/ARCHITECTURE.md#performance-measured).

## Deploy (Azure)
1. A subscription owner runs `infra/terraform/bootstrap` once (state storage + GitHub OIDC app).
2. `infra/terraform/envs/<env>`: `terraform init && terraform apply -var-file=<env>.tfvars`.
3. Configure the GitHub environments `dev`, `staging` and `prod` (variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
   `AZURE_SUBSCRIPTION_ID`, `RESOURCE_GROUP`, `ACR_NAME`; required reviewers on `prod`).
4. Push to `main`: `deploy.yml` builds the images, runs migrations as a Container Apps Job and deploys dev → staging → prod.
5. Seed reference data once per environment: `python -m app.seed --admin-password <temporary>`, then sign in as
   `admin`, change the password, enable TOTP, and enter real rates (ASF, GST, matrix, tiers, season calendar).
   **Never run `seed_demo` in production.**

## Repository layout
```
backend/   FastAPI app (app/<module>/{router,service,domain,models,schemas}.py), Alembic, tests
frontend/  Next.js app (src/app, src/components), Vitest tests, Playwright e2e
infra/     Terraform (bootstrap, modules/crm, envs/dev|staging|prod), local init SQL
scripts/   seed-demo.sh, local_db.py, load/ (k6 + volume generator)
docs/      all documentation listed above
.github/   CI (lint, type, test, e2e, terraform) and OIDC deploy pipelines
```

## Data protection notes
No real member data appears in seeds, tests or docs. Aadhaar is stored masked only (a flag stays off until the
legal basis is confirmed). Other KYC numbers are envelope-encrypted with a Key Vault HSM key, and viewing them
needs `kyc.view_full` and is logged. Card numbers are never stored, only the last 4 digits. Prices, fees, ASF and
GST rates, the matrix and the tiers are all master data. The only figures in code are clearly labelled DEMO seed values.
