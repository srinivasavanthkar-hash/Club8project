"""RFC 7807 problem+json errors."""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import StaleDataError


class DomainError(Exception):
    status = 400
    type_ = "about:blank"
    title = "Business rule violated"

    def __init__(self, detail: str, *, code: str | None = None, extra: dict[str, Any] | None = None) -> None:
        super().__init__(detail)
        self.detail = detail
        self.code = code or self.__class__.__name__
        self.extra = extra or {}


class NotFound(DomainError):
    status = 404
    title = "Not found"


class Forbidden(DomainError):
    status = 403
    title = "Forbidden"


class Unauthorized(DomainError):
    status = 401
    title = "Unauthorized"


class Conflict(DomainError):
    status = 409
    title = "Conflict"


class RuleViolation(DomainError):
    status = 422
    title = "Business rule violated"


class OverrideRequired(DomainError):
    """A warning-level rule that may be bypassed with an override reason (and permission)."""

    status = 422
    title = "Override required"


def _problem(status: int, title: str, detail: str, code: str, request: Request, **extra: Any) -> JSONResponse:
    body = {
        "type": f"https://club8-crm/errors/{code}",
        "title": title,
        "status": status,
        "detail": detail,
        "instance": str(request.url.path),
        "code": code,
        **extra,
    }
    return JSONResponse(body, status_code=status, media_type="application/problem+json")


def install_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _domain(request: Request, exc: DomainError) -> JSONResponse:
        return _problem(exc.status, exc.title, exc.detail, exc.code, request, **exc.extra)

    @app.exception_handler(StaleDataError)
    async def _stale(request: Request, exc: StaleDataError) -> JSONResponse:
        return _problem(
            409,
            "Version conflict",
            "Record was modified by someone else. Reload and retry.",
            "VersionConflict",
            request,
        )

    @app.exception_handler(IntegrityError)
    async def _integrity(request: Request, exc: IntegrityError) -> JSONResponse:
        constraint = getattr(getattr(exc.orig, "__cause__", None), "constraint_name", None)
        return _problem(
            409,
            "Integrity conflict",
            "A unique or referential constraint was violated.",
            "IntegrityConflict",
            request,
            constraint=constraint,
        )

    @app.exception_handler(ValidationError)
    async def _pyd(request: Request, exc: ValidationError) -> JSONResponse:
        errors = [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
        return _problem(
            422, "Validation failed", "One or more fields are invalid.", "ValidationError", request, errors=errors
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
        return _problem(
            422, "Validation failed", "One or more fields are invalid.", "ValidationError", request, errors=errors
        )
