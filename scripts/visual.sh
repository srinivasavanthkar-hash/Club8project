#!/bin/sh
# Visual regression in Playwright's official Linux image (the same version as frontend's @playwright/test), so the
# reference images are identical wherever they are made or compared: on any developer machine and in CI.
#
#   sh scripts/visual.sh             compare the screens with the committed references (CI runs this)
#   sh scripts/visual.sh --update    re-create the references after an intended change; review them, then commit
#
# Self-contained: copies frontend/ into the container (its own Linux node_modules), builds the app, serves it on
# :3000 inside the container and runs e2e/visual.spec.ts against recorded FICTITIOUS API data (no backend needed).
# A missing reference fails the run. The Playwright report is copied to frontend/playwright-report-visual/.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
VERSION=$(node -p "require('$ROOT/frontend/package.json').devDependencies['@playwright/test']" 2>/dev/null \
  || grep -o '"@playwright/test": *"[^"]*"' "$ROOT/frontend/package.json" | grep -o '[0-9][0-9.]*')
IMAGE="mcr.microsoft.com/playwright:v${VERSION}-noble"
UPDATE=""
[ "${1:-}" = "--update" ] && UPDATE="--update-snapshots=all"
echo "==> $IMAGE ${UPDATE:+(updating references)}"
mkdir -p "$ROOT/frontend/e2e/visual.spec.ts-snapshots" "$ROOT/frontend/playwright-report-visual"
MSYS_NO_PATHCONV=1 docker run --rm --ipc=host \
  -v "$ROOT/frontend:/src:ro" \
  -v "$ROOT/frontend/e2e/visual.spec.ts-snapshots:/snapshots" \
  -v "$ROOT/frontend/playwright-report-visual:/report" \
  -e UPDATE="$UPDATE" -e GREP="${GREP:-}" -e PLAYWRIGHT_OFFICIAL_IMAGE=1 -e NEXT_TELEMETRY_DISABLED=1 -e CI=1 \
  "$IMAGE" bash -c '
    set -euo pipefail
    mkdir /work && cd /src && tar --exclude=./node_modules --exclude="./.next*" --exclude=./playwright-report* \
      --exclude=./test-results --exclude=./e2e/visual.spec.ts-snapshots -cf - . | tar -xf - -C /work
    cd /work && ln -s /snapshots e2e/visual.spec.ts-snapshots
    npm ci --no-audit --no-fund --loglevel=error
    API_INTERNAL_URL=http://127.0.0.1:9 npx next build > /tmp/build.log 2>&1 || { tail -40 /tmp/build.log; exit 1; }
    npx next start -p 3000 > /tmp/next.log 2>&1 &
    for i in $(seq 1 90); do
      node -e "fetch(\"http://127.0.0.1:3000/login\").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && break
      sleep 1
    done
    status=0
    E2E_BASE_URL=http://127.0.0.1:3000 npx playwright test visual --project=desktop --reporter=list,html ${GREP:+-g "$GREP"} $UPDATE || status=$?
    cp -r playwright-report/. /report/ 2>/dev/null || true
    exit $status
  '
