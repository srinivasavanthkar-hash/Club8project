# Club8 Holidays / K8 CRM — Build Plan

## Architecture (summary — detail in ARCHITECTURE.md)

```
Browser ──HTTPS──► Azure Front Door + WAF ──► Next.js 15 (Container App, public)
                                                │  rewrites /api/v1/* (same origin, httpOnly cookies)
                                                ▼
                                      FastAPI API (Container App, internal ingress)
                                        │        │            │
                     PostgreSQL 16 Flexible   Azure Blob   Azure Cache for Redis ◄── Worker (Container App)
                     (private endpoint)       (private)    (queue + rate limit)       Dramatiq jobs
                                        │
                                   Key Vault (managed identity): DB creds, JWT keys, KYC KEK
```

* **Backend** is a modular monolith. One package per module, each `router → service → repository`,
  with Pydantic schemas and SQLAlchemy models kept separate.
* **Business rules** live in pure, I/O-free `domain.py` modules (EMI, ASF, entitlement, cancellation tiers,
  booking window, occupancy, state machines, duplicate scoring, hash chain). Services orchestrate
  domain + repositories inside one transaction. This makes every rule unit-testable without a DB.
* **Audit** is central: request middleware puts user/IP/UA into `contextvars`; SQLAlchemy
  `before_flush` captures field-level diffs into `record_versions` and `activity_log`; services
  add semantic events (`audit.record(...)`). `activity_log` is append-only (grants + trigger) and hash-chained.
* **Configuration** is all master data with effective dates; nothing price/rate/rule-like is hard-coded.

## Data model
See `docs/DATA_MODEL.md`. UUID PKs and human-readable numbers (`L-2026-000123`, `MSMC8-9030`,
`RC-<CO>-2026-000001`, `R-2026-000001`), `numeric(14,2)` money, `numeric(5,1)` nights, `version` columns
for optimistic locking, and soft delete.

## Modules
`auth/rbac`, `admin` (master data), `audit`, `search`, `leads`, `members`, `finance`, `entitlement`,
`reservations`, `correspondence` (emails, calls, letters, documents, timeline), `exports`, `storage`, `jobs`.

## Milestones
1. Foundation: repo, Docker, CI, auth, RBAC, master data, audit + versioning, search skeleton
2. Leads and members: conversion, duplicates, approval, custom fields
3. Finance: EMI, payments/allocations, ASF + GST, receipts, totals, corrections, default notice
4. Reservations and entitlement: state machine, rules, reschedule, cancellation tiers, save/borrow, matrix
5. Correspondence and documents: .eml/.msg, calls, letters, documents, timeline
6. Wrap-up: audit viewer, exports, backups, hardening, docs
7. Demo: seed script + Playwright e2e

## Environment note
The build workstation has no Docker/PostgreSQL. Pure-domain unit tests run locally. Integration
tests (testcontainers PostgreSQL) and Playwright e2e run in CI (GitHub Actions has Docker).
