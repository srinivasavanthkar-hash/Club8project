import logging
import sys

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
from app.core.middleware import CsrfMiddleware, RequestContextMiddleware, SecurityHeadersMiddleware
from app.core.ratelimit import limiter
from app.correspondence.router import router as correspondence_router
from app.dashboard import router as dashboard_router
from app.entitlement.router import router as entitlement_router
from app.exports.router import router as exports_router
from app.finance.router import router as finance_router
from app.leads.router import router as leads_router
from app.members.router import router as members_router
from app.reservations.router import router as reservations_router
from app.search.router import router as search_router


def create_app() -> FastAPI:
    settings = get_settings()
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
    ):
        api.include_router(r)
    app.include_router(api)

    @app.get("/healthz", include_in_schema=False)
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

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
