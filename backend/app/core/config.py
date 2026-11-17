"""Application settings.

Secrets are never read from files committed to the repo. In Azure, the Container App
injects Key Vault references as environment variables via managed identity
(`secretref:`), so the app only ever sees env vars. Locally, docker-compose supplies
development-only values.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CRM_", env_file=None, extra="ignore")

    env: Literal["local", "test", "dev", "staging", "prod"] = "local"
    database_url: SecretStr = SecretStr("postgresql+asyncpg://crm_app:crm_app@localhost:5432/crm")
    # Owner role used only by Alembic (DDL + grants). The app role has no UPDATE/DELETE on activity_log.
    migration_database_url: SecretStr | None = None
    redis_url: str = "redis://localhost:6379/0"

    jwt_signing_key: SecretStr = SecretStr("local-dev-only-change-me-0123456789abcdef")
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 7
    cookie_secure: bool = True

    max_failed_logins: int = 5
    lockout_minutes: int = 15

    # KYC envelope encryption. In Azure: Key Vault key wraps per-record DEKs.
    kyc_key_provider: Literal["local", "keyvault"] = "local"
    kyc_local_kek: SecretStr = SecretStr("bG9jYWwtZGV2LW9ubHkta2V5LTAxMjM0NTY3ODlhYmM=")  # 32-byte b64, dev only
    keyvault_url: str | None = None
    keyvault_kyc_key_name: str = "kyc-kek"

    # Blob storage
    blob_provider: Literal["azurite", "azure", "memory"] = "azurite"
    blob_account_url: str = "http://127.0.0.1:10000/devstoreaccount1"
    blob_connection_string: SecretStr | None = None  # Azurite only; Azure uses managed identity
    blob_container_documents: str = "documents"
    sas_minutes: int = 10

    virus_scan_provider: Literal["clamav", "defender", "none"] = "clamav"
    clamav_host: str = "localhost"
    clamav_port: int = 3310

    # Data protection flags
    aadhaar_full_storage_enabled: bool = False  # off until legal basis confirmed (OPEN_QUESTIONS #13)

    # True only for a throwaway stack built for the Playwright suites (scripts/run_e2e.py, CI). Specs that write data
    # refuse to run unless the API reports it, so they can never write to the demo (or any real) database.
    e2e_target: bool = False

    # Designated super-admin (username). Configuration only, never editable in the UI. May reset another ADMIN's
    # password directly, but only when no second admin is available to approve (docs/DECISIONS.md D-PW-3).
    super_admin_username: str | None = None

    # Breached-password check (Have I Been Pwned range API, k-anonymity: only the first 5 hex characters of the
    # SHA-1 hash leave the server). If the API is unreachable the bundled offline list is used; the user is never
    # blocked because the API is down.
    password_breach_api_enabled: bool = True
    password_breach_api_url: str = "https://api.pwnedpasswords.com/range/"  # noqa: S105 - a URL, not a secret
    password_breach_api_timeout_seconds: float = 2.0

    rate_limit_login: str = "10/minute"
    # per account (username), on top of the per-IP limit above
    rate_limit_login_account: str = "5/minute"
    rate_limit_change_password: str = "5/minute"  # noqa: S105 - a rate (per account), not a secret
    # per IP: generous, because an office shares one NAT address; the per-account limit above is the strict one
    rate_limit_change_password_ip: str = "30/minute"  # noqa: S105 - a rate, not a secret
    # per IP, abuse caps on the unauthenticated reset endpoints (the hourly per-account / per-IP limits that decide
    # whether an email is sent are business settings: password.forgot_per_*_per_hour)
    rate_limit_forgot_ip: str = "30/minute"
    rate_limit_reset_ip: str = "30/minute"
    # per client IP; offices share one NAT address, so this is deliberately generous (login is strict)
    rate_limit_default: str = "1200/minute"
    max_upload_mb: int = Field(default=15, description="Default; overridable in system_settings table")

    # Links in emails are built from this, never from the request's Host header (host-header poisoning).
    app_base_url: str = "http://localhost:3000"

    # Email (docs/PASSWORD_PROMPT.md Section 7). smtp = Mailpit locally / CI; acs = Azure Communication Services
    # (managed identity, endpoint from Key Vault); memory = tests (kept in-process); none = drop and log.
    email_provider: Literal["smtp", "acs", "memory", "none"] = "smtp"
    email_from: str = "Club8 CRM <no-reply@club8-crm.example>"  # FICTITIOUS default; real domain: OPEN_QUESTIONS 29
    smtp_host: str = "127.0.0.1"
    smtp_port: int = 1025
    acs_endpoint: str | None = None
    # worker = Dramatiq job with retries (Azure, docker); inline = in-process task with retries (local, tests)
    email_dispatch: Literal["worker", "inline"] = "inline"
    default_brand: Literal["club8", "k8"] = "club8"  # logo and colours in emails (same as NEXT_PUBLIC_DEFAULT_BRAND)
    admin_contact: str = "your CRM administrator"  # shown in emails ("Questions? Contact ...")

    # CAPTCHA on "Forgot password" after N requests per IP per hour (N in system_settings). none = off.
    captcha_provider: Literal["none", "turnstile", "hcaptcha"] = "none"
    captcha_site_key: str | None = None
    captcha_secret_key: SecretStr | None = None

    otel_enabled: bool = False
    applicationinsights_connection_string: SecretStr | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
