#!/usr/bin/env bash
# Seed a fresh environment with FICTITIOUS demo data and (optionally) run the Section 14 demo scenario.
#
#   scripts/seed-demo.sh                 # docker-compose stack: migrate, seed demo master data/users, run scenario
#   scripts/seed-demo.sh --no-scenario   # only master data + demo users (e.g. before the Playwright e2e)
#
# Demo users: demo.admin, demo.manager, demo.marketing, demo.sales, demo.team, demo.finance,
#             demo.reservations, demo.service   password: $CRM_DEMO_PASSWORD (default Demo-Passw0rd!)
# Never run against production: demo ASF amounts and the demo season calendar are labelled DEMO data.
set -euo pipefail

SCENARIO=1
[[ "${1:-}" == "--no-scenario" ]] && SCENARIO=0
BASE_URL="${E2E_BASE_URL:-http://localhost:3000}"
COMPOSE="docker compose"

if [[ "${CRM_ENV:-local}" == "prod" ]]; then
  echo "Refusing to seed demo data into production." >&2
  exit 1
fi

echo "==> Running migrations"
$COMPOSE run --rm migrate

echo "==> Seeding reference + DEMO master data and users"
$COMPOSE run --rm -e CRM_DATABASE_URL="postgresql+asyncpg://crm_owner:crm_owner_dev@postgres:5432/crm" \
  api python -m app.seed_demo

if [[ $SCENARIO == 1 ]]; then
  echo "==> Waiting for ${BASE_URL}"
  for _ in $(seq 1 60); do curl -fs "${BASE_URL}/login" >/dev/null && break; sleep 2; done
  echo "==> Running the Section 14 demo scenario through the API"
  $COMPOSE run --rm -e PYTHONPATH=/app api python -m app.demo_cli --base-url "http://web:3000"
fi
echo "Done. Open ${BASE_URL} and sign in as demo.manager."
