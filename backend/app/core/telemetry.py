"""OpenTelemetry -> Azure Monitor / Application Insights."""

from fastapi import FastAPI


def setup_telemetry(app: FastAPI, connection_string: str) -> None:  # pragma: no cover
    from azure.monitor.opentelemetry import configure_azure_monitor

    configure_azure_monitor(connection_string=connection_string, logger_name="crm", enable_live_metrics=True)
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

    from app.core.db import get_engine

    FastAPIInstrumentor.instrument_app(app, excluded_urls="healthz,readyz")
    SQLAlchemyInstrumentor().instrument(engine=get_engine().sync_engine)
