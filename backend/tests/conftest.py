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

from hypothesis import HealthCheck, settings

# Property tests run under coverage tracing in CI; wall-clock deadlines make them flaky, not stricter.
settings.register_profile("crm", deadline=None, suppress_health_check=[HealthCheck.too_slow])
settings.load_profile("crm")
