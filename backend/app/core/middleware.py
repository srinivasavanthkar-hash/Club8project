"""Request context, security headers and CSRF (double-submit cookie) middleware."""

import hmac
import json
import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.context import RequestContext, set_context

log = logging.getLogger("crm.request")
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
CSRF_EXEMPT = {"/api/v1/auth/login", "/api/v1/auth/refresh", "/healthz", "/readyz"}


def client_ip(request: Request) -> str | None:
    # Front Door / Container Apps ingress set X-Forwarded-For; first hop is the client.
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()[:45]
    return request.client.host if request.client else None


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        reason = request.headers.get("x-change-reason")
        set_context(
            RequestContext(
                request_id=rid[:64],
                ip=client_ip(request),
                user_agent=request.headers.get("user-agent"),
                reason=reason[:500] if reason else None,
            )
        )
        start = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        log.info(
            json.dumps(
                {
                    "event": "request",
                    "request_id": rid,
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "ms": round((time.perf_counter() - start) * 1000, 1),
                }
            )
        )
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        h = response.headers
        h.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("Referrer-Policy", "no-referrer")
        h.setdefault("Cache-Control", "no-store")
        h.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        return response


class CsrfMiddleware(BaseHTTPMiddleware):
    """Unsafe requests authenticated by cookie must echo the csrf cookie in X-CSRF-Token."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if (
            request.method not in SAFE_METHODS
            and request.url.path not in CSRF_EXEMPT
            and "crm_access" in request.cookies
        ):
            cookie = request.cookies.get("crm_csrf", "")
            header = request.headers.get("x-csrf-token", "")
            if not cookie or not hmac.compare_digest(cookie, header):
                return JSONResponse(
                    {
                        "type": "https://club8-crm/errors/CsrfFailed",
                        "title": "Forbidden",
                        "status": 403,
                        "detail": "CSRF token missing or invalid",
                        "code": "CsrfFailed",
                    },
                    status_code=403,
                    media_type="application/problem+json",
                )
        return await call_next(request)
