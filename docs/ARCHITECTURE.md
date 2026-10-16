# Architecture

## Runtime view (Azure, Central India; backups geo-replicated to South India)

```mermaid
flowchart LR
  U[Staff browser / phone] -->|HTTPS| FD[Azure Front Door Premium<br/>+ WAF: OWASP DRS 2.1, bot rules, login rate limit]
  FD -->|Private Link| WEB[Container App: crm-web<br/>Next.js 15, standalone]
  subgraph VNET[VNet 10.40.0.0/16, internal Container Apps environment]
    WEB -->|/api/v1/* rewrite, same origin| API[Container App: crm-api<br/>FastAPI + Gunicorn/Uvicorn, ≥2 replicas in prod]
    API --> PG[(PostgreSQL 16 Flexible Server<br/>zone-redundant HA, PITR 35 d, geo backup)]
    API --> RED[(Azure Cache for Redis)]
    API --> BLOB[(Blob Storage, private<br/>versioning, soft delete, GRS)]
    API --> KV[Key Vault<br/>secrets + KYC KEK (HSM)]
    WRK[Container App: crm-worker<br/>Dramatiq] --> PG
    WRK --> RED
    SCH[crm-scheduler] -->|enqueue| RED
    JOB1[Job: crm-migrate<br/>alembic upgrade] --> PG
    JOB2[Job: weekly pg_dump] --> BLOBB[(immutable db-backups container)]
  end
  DEF[Defender for Storage<br/>malware scanning] -. index tag .-> BLOB
  API & WEB & WRK -. OpenTelemetry .-> AI[Application Insights / Log Analytics]
```

* Only the web app is reachable from the internet, and only through Front Door (the Container Apps environment
  is internal). The API has internal ingress and is reached through the Next.js `/api/v1/*` rewrite, so auth
  cookies stay first-party and CORS is never needed.
* PostgreSQL, Blob, Key Vault, Redis and ACR use private endpoints / VNet integration. Public network access is off.
* Every app uses one **user-assigned managed identity**: Key Vault Secrets User and Crypto User, Storage Blob Data
  Contributor and Blob Delegator (for user-delegation SAS), and AcrPull. There are no secrets in images, env files
  or the repo; Container Apps resolve Key Vault references at start-up.

## Backend structure

```
backend/app
  core/          config, db (session + TransactionalRoute), errors (RFC 7807), security, crypto (envelope),
                 middleware (context, security headers, CSRF), state machines, sequences, settings store
  auth/ admin/   login, refresh rotation, TOTP; RBAC; master data and effective-dated rate tables
  leads/ members/ finance/ entitlement/ reservations/ correspondence/ search/ exports/ audit/
      each:  router.py → service.py → (SQLAlchemy models) ; domain.py = pure rules (no I/O)
  storage/       blob port (Azure / Azurite / memory), virus-scan port (Defender / ClamAV), file-type sniffing
  jobs/          Dramatiq actors + scheduler (idempotent)
```

* **Transactions.** There is one `AsyncSession` per request. `TransactionalRoute` commits **before** the response
  is sent (D-25), so a failed commit becomes an error response, never a false success. Multi-step operations
  (conversion, allocation, booking + hold + ASF) run in that single transaction.
* **Concurrency.** Entitlement operations lock the member's `entitlement_years` rows (`SELECT … FOR UPDATE`) and
  plan under the lock. Every ledger row has a unique idempotency key, and a partial unique index allows only one
  active deduction per reservation. Optimistic locking (`version` column) turns concurrent edits into HTTP 409.
* **Audit.** Request middleware stores user, IP, user agent and request id in `contextvars`. A SQLAlchemy
  `after_flush` hook writes field-level diffs to `record_versions` and queues activity events; `before_commit`
  appends them to the hash-chained `activity_log` under an advisory lock. Services add semantic events (login,
  approve, KYC view, export…). Rolled-back transactions leave no audit rows.
* **Security.** bcrypt passwords (policy-checked), lockout after 5 failures, JWT access (15 min) and rotating
  refresh (7 d, reuse detection) tokens in httpOnly `SameSite=Strict` cookies, double-submit CSRF, optional TOTP,
  slowapi rate limits (Redis-backed), strict security headers, magic-byte upload checks, sandboxed Jinja for
  letters, and CSV formula-injection escaping. Permissions are enforced by FastAPI dependencies on every route;
  Next.js only hides menu items.
* **KYC.** PAN, DL, passport and voter ID are encrypted with AES-256-GCM using a fresh data key per value. The key
  is wrapped by an RSA-HSM key in Key Vault (`kyc-kek`, yearly rotation; old versions stay enabled for unwrapping).
  An HMAC lookup hash supports duplicate checks without decrypting. Aadhaar is stored masked only.

### KYC key rotation
1. Key Vault creates a new `kyc-kek` version automatically (rotation policy) or on demand.
2. New values are wrapped with the new version (the stored token records the KEK id).
3. Optional re-wrap: a one-off job unwraps each DEK with the old version and re-wraps it with the new one. Data is
   never re-encrypted because the DEKs do not change. After that, disable the old key version.

## Frontend
Next.js 15 App Router + TypeScript (strict). TanStack Query for data, React Hook Form + Zod for forms, TanStack
Table for lists, Tailwind + shadcn-style components. Client components handle interactive screens; server
components only the shell. `middleware.ts` redirects signed-out users. Nothing personal is cached at the Next.js
layer (`Cache-Control: no-store`, no ISR).

## CI/CD
* `ci.yml`: ruff + mypy (strict on core/domain/service) + pytest with testcontainers PostgreSQL and a coverage
  gate (≥80% on the service + domain layer; 90% at the time of writing); ESLint, tsc, Vitest, `next build`;
  docker-compose stack + Section 14 scenario + Playwright e2e; `terraform fmt` + `validate`.
* `deploy.yml`: OIDC login (no stored secrets) → build and push images to ACR → for each environment: run the
  `crm-migrate` Container Apps Job (pre-deploy), update the apps, smoke test. `prod` needs required reviewers
  on the GitHub environment.

## Performance (measured)
Local embedded PostgreSQL 16 **without** `pg_trgm` (worst case: sequential substring scans), 100,000 members and
~1,000,000 payments, generated with `scripts/load/generate_volume.py`, measured in-process (15 calls each):

| Endpoint | p50 | p95 | Target |
|---|---|---|---|
| Search: membership no. without prefix | 536 ms | 583 ms | < 1 s |
| Search: partial name | 201 ms | 211 ms | < 1 s |
| Search: mobile fragment | 520 ms | 608 ms | < 1 s |
| Search: email fragment | 91 ms | 104 ms | < 1 s |
| Members list (25 rows, filtered) | 142 ms | 156 ms | < 2 s |
| Member record / payments / finance summary / timeline | 13–21 ms | 18–23 ms | < 2 s |
| Dashboard | 25 ms | 54 ms | < 2 s |

Azure PostgreSQL has `pg_trgm` enabled (Terraform `azure.extensions`), and migration `0001` then adds GIN trigram
indexes on names, emails, mobiles, membership and lead numbers, which turn the substring searches into index
scans. Re-run `scripts/load/k6-search-and-pages.js` against staging before go-live to confirm end-to-end latency
through Front Door.
