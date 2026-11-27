"""Test configuration.

Integration tests need a real PostgreSQL 16 (never SQLite). Resolution order:
1. CRM_TEST_DATABASE_URL (an admin URL; a fresh database is created per run)
2. testcontainers PostgreSQL (CI, any machine with Docker)
3. pgserver (pip-installed embedded PostgreSQL; developer machines without Docker)
"""

import os

os.environ.setdefault("CRM_ENV", "test")
os.environ.setdefault("CRM_BLOB_PROVIDER", "memory")
os.environ.setdefault("CRM_VIRUS_SCAN_PROVIDER", "none")
os.environ.setdefault("CRM_COOKIE_SECURE", "false")
os.environ.setdefault("CRM_RATE_LIMIT_LOGIN", "10000/minute")
os.environ.setdefault("CRM_RATE_LIMIT_DEFAULT", "100000/minute")
os.environ.setdefault("CRM_RATE_LIMIT_LOGIN_ACCOUNT", "10000/minute")
os.environ.setdefault("CRM_RATE_LIMIT_CHANGE_PASSWORD", "10000/minute")
os.environ.setdefault("CRM_RATE_LIMIT_CHANGE_PASSWORD_IP", "10000/minute")
os.environ.setdefault("CRM_RATE_LIMIT_FORGOT_IP", "10000/minute")
os.environ.setdefault("CRM_RATE_LIMIT_RESET_IP", "10000/minute")
# Never call the live breached-password API from tests: the offline list answers (tests that cover the API mock it).
os.environ.setdefault("CRM_PASSWORD_BREACH_API_ENABLED", "false")
# Emails are kept in app.email.sender.OUTBOX and sent in-process after commit.
os.environ.setdefault("CRM_EMAIL_PROVIDER", "memory")
os.environ.setdefault("CRM_EMAIL_DISPATCH", "inline")
# Marked stub PDFs for the suite; the rendering tests (tests/integration/test_pdf_render.py) use the real engine.
os.environ.setdefault("CRM_PDF_ENGINE", "test_stub")
# A fixed business date: results that depend on "today" (year-end rules, lead times, overdue instalments) do not change
# as the calendar moves. The same date as the e2e stacks (frontend/e2e/support/clock.ts); README "Tests".
os.environ.setdefault("CRM_FIXED_TODAY", "2026-11-16")
os.environ.setdefault("CRM_APP_BASE_URL", "https://crm.club8.example")

from hypothesis import HealthCheck, settings

# Property tests run under coverage tracing in CI; wall-clock deadlines make them flaky, not stricter.
settings.register_profile("crm", deadline=None, suppress_health_check=[HealthCheck.too_slow])
settings.load_profile("crm")
