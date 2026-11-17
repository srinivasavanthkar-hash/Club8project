# syntax=docker/dockerfile:1.7
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
# WeasyPrint (Pango) and libmagic for PDF generation and content-type sniffing
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libffi8 libmagic1 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY pyproject.toml ./
# Runtime dependencies only (dev extras are installed in CI, not in the image)
RUN python -c "import tomllib;print('\n'.join(tomllib.load(open('pyproject.toml','rb'))['project']['dependencies']))"       > requirements.txt && pip install --upgrade pip && pip install -r requirements.txt

FROM base AS runtime
COPY --from=deps /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./
# A home directory: gunicorn's control socket and fontconfig's cache (WeasyPrint PDFs) are written there
RUN useradd --uid 10001 --create-home crm && chown -R crm /app
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/healthz')"
# API by default; the worker and migration jobs override the command (see infra / docker-compose).
CMD ["gunicorn", "app.main:app", "-k", "uvicorn.workers.UvicornWorker", "-w", "4", "-b", "0.0.0.0:8000", \
     "--timeout", "60", "--graceful-timeout", "30", "--access-logfile", "-"]
