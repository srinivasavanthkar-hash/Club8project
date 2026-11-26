import logging
import sys
import time

from fastapi import APIRouter, FastAPI
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from app.admin.router import router as admin_router
from app.audit.router import router as audit_router
from app.audit.service import install_session_hooks
from app.auth.router import router as auth_router
from app.core.config import get_settings
from app.core.db import get_engine
from app.core.errors import install_handlers
from app.core.logscrub import install as install_log_scrubber
from app.core.middleware import CsrfMiddleware, RequestContextMiddleware, SecurityHeadersMiddleware
from app.core.ratelimit import limiter
from app.correspondence.pdf import engine_status, require_engine
from app.correspondence.router import router as correspondence_router
from app.dashboard import router as dashboard_router
from app.email.dispatch import install as install_email_dispatch
from app.entitlement.router import router as entitlement_router
from app.exports.router import router as exports_router
from app.finance.router import router as finance_router
from app.leads.router import router as leads_router
from app.members.router import router as members_router
from app.reservations.router import router as reservations_router
from app.search.router import router as search_router
from app.ui_settings import router as ui_settings_router


async def _record_rate_limit(path: str) -> None:
    """Per-IP limit hit on an auth route: log it in its own short transaction (the request never reached its
    handler, so there is no request session). The IP comes from the request context."""
    from app.audit import service as audit
    from app.core.db import sessionmaker

    try:
        async with sessionmaker()() as s:
            audit.record(s, "RATE_LIMITED", f"Per-IP rate limit reached on {path}")
            await s.commit()
    except Exception:
        logging.getLogger("crm.auth").warning("Could not record a rate-limit event")


def create_app() -> FastAPI:
    settings = get_settings()
    install_log_scrubber()  # before anything logs: passwords and tokens never reach a handler or telemetry
    logging.basicConfig(stream=sys.stdout, level=logging.INFO, format="%(message)s")
    install_session_hooks()
    app = FastAPI(
        title="Club8 Holidays / K8 CRM API",
        version="1.0.0",
        openapi_url="/api/v1/openapi.json",
        docs_url="/api/v1/docs" if settings.env != "prod" else None,
        redoc_url=None,
    )
    app.state.limiter = limiter

    @app.exception_handler(RateLimitExceeded)
    async def _rl(request, exc):  # type: ignore[no-untyped-def]
        if request.url.path.startswith("/api/v1/auth/"):  # sign-in / password limits are security events
            await _record_rate_limit(request.url.path)
        return JSONResponse(
            {
                "type": "https://club8-crm/errors/RateLimited",
                "title": "Too many requests",
                "status": 429,
                "detail": "Too many requests, slow down.",
                "code": "RateLimited",
            },
            status_code=429,
            media_type="application/problem+json",
        )

    install_handlers(app)
    app.add_middleware(CsrfMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestContextMiddleware)

    api = APIRouter(prefix="/api/v1")
    for r in (
        auth_router,
        admin_router,
        leads_router,
        members_router,
        finance_router,
        entitlement_router,
        reservations_router,
        correspondence_router,
        audit_router,
        exports_router,
        search_router,
        dashboard_router,
        ui_settings_router,
    ):
        api.include_router(r)
    app.include_router(api)

    if settings.env == "prod" and settings.e2e_target:
        raise RuntimeError("CRM_E2E_TARGET must never be set in production")
    if settings.env in ("staging", "prod") and not settings.app_base_url.startswith("https://"):
        raise RuntimeError("CRM_APP_BASE_URL must be the public https:// address (links in emails are built from it)")
    install_email_dispatch()
    require_engine("api")  # no PDF engine, no start (receipts are created inside the payment transaction)
    pdf_check: dict[str, float | str] = {"at": time.monotonic(), "status": engine_status()[0]}

    @app.get("/healthz", include_in_schema=False)
    async def healthz() -> JSONResponse:
        if time.monotonic() - float(pdf_check["at"]) > 300:  # re-checked at most every 5 minutes
            pdf_check.update(at=time.monotonic(), status=engine_status()[0])
        pdf = str(pdf_check["status"])  # ok | test_stub | error
        return JSONResponse(
            {"status": "error" if pdf == "error" else "ok", "pdf_engine": pdf},
            status_code=503 if pdf == "error" else 200,
        )

    @app.get("/api/v1/meta", include_in_schema=False)
    async def meta() -> dict[str, bool]:
        """Lets the Playwright suites confirm they are pointed at a throwaway e2e stack before writing anything."""
        return {"e2e_target": settings.e2e_target}

    @app.get("/readyz", include_in_schema=False)
    async def readyz() -> JSONResponse:
        try:
            async with get_engine().connect() as c:
                await c.execute(text("SELECT 1"))
            return JSONResponse({"status": "ready"})
        except Exception:
            return JSONResponse({"status": "db-unavailable"}, status_code=503)

    if settings.otel_enabled and settings.applicationinsights_connection_string:  # pragma: no cover
        from app.core.telemetry import setup_telemetry

        setup_telemetry(app, settings.applicationinsights_connection_string.get_secret_value())
    return app


app = create_app()
