#!/bin/sh
# Run the PDF rendering tests (real WeasyPrint + Pango) in the backend Docker image's base layer, so they behave the
# same on Windows, macOS and Linux. No database needed. Usage: sh scripts/test-pdf-render.sh [extra pytest args]
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
docker build -q --target base -t club8-crm-backend-base "$ROOT/backend" >/dev/null
MSYS_NO_PATHCONV=1 docker run --rm -v "$ROOT/backend:/src:ro" club8-crm-backend-base sh -c '
  set -e
  cp -r /src /work && cd /work && rm -rf .pytest_cache *.egg-info
  python -c "import tomllib;d=tomllib.load(open(\"pyproject.toml\",\"rb\"))[\"project\"];print(\"\n\".join(d[\"dependencies\"]+d[\"optional-dependencies\"][\"dev\"]))" > /tmp/req.txt
  pip install -q --root-user-action=ignore -r /tmp/req.txt 2>&1 | grep -v "notice\]" || true
  CI=1 pytest -q -p no:cacheprovider -m pdf_render tests/unit "$@"
' sh "$@"
