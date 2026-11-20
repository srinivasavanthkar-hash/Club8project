"""Run the Playwright suites against a THROWAWAY stack, never the demo database.

    python scripts/run_e2e.py                       # all suites
    python scripts/run_e2e.py passwords             # any Playwright arguments (spec filter, --project=..., -g ...)
    TOUR=1 python scripts/run_e2e.py tour passwords  # walkthrough screenshots (fictitious data)
    python scripts/run_e2e.py --no-build ...        # reuse the previous e2e frontend build

Needs Docker: the API runs from the backend Docker image, which carries the PDF engine (WeasyPrint + Pango); the
API refuses to start without it (docs/DECISIONS.md D-PDF-1, D-PDF-2).

What it does (and undoes):
1. On a private Docker network: a throwaway PostgreSQL 16 (data on tmpfs, 127.0.0.1:5436) with a fresh database
   `crm_e2e` (migrations, DEMO master data and users), and its own Mailpit (SMTP :1026, API :8026) for the reset
   emails of this run. Never crm_local, never the demo stack.
2. Starts the API from the backend image on :8001 with CRM_E2E_TARGET=true. Specs that write data refuse to run
   unless the API reports it (frontend/e2e/support/stack.ts), so they can never touch the demo database on :8000.
3. Builds the frontend into .next-e2e (pointed at :8001) and serves it on :3001. The demo build in .next is untouched.
4. Runs Playwright against :3001, then removes the containers and the network and stops the frontend. The API log
   is saved to .local/e2e-api.log.
"""

# ruff: noqa: S603, S607 - a developer tool that starts known local programs (docker, node, npx) with fixed arguments
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCAL = ROOT / ".local"
PY = sys.executable
NET = "club8-crm-e2e"
DB = "club8-crm-e2e-db"
MAIL = "club8-crm-e2e-mailpit"
API = "club8-crm-e2e-api"
IMAGE = "club8-crm-backend:e2e"
# Development-only credentials for a database that lives for one run; published on 127.0.0.1 only.
DB_USER, DB_PASSWORD, DB_PORT = "crm_owner", "crm_e2e_dev", 5436


def wait_for(url: str, seconds: int = 120) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3) as r:  # noqa: S310 - local URL built here
                if r.status < 500:
                    return
        except Exception:  # not up yet
            time.sleep(1)
    raise SystemExit(f"Timed out waiting for {url}")


def docker(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    r = subprocess.run(["docker", *args], capture_output=True, text=True)
    if check and r.returncode != 0:
        raise SystemExit(f"docker {' '.join(args[:2])} failed:\n{r.stdout}{r.stderr}")
    return r


def cleanup() -> None:
    if docker("inspect", API, check=False).returncode == 0:
        logs = docker("logs", API, check=False)
        (LOCAL / "e2e-api.log").write_text(logs.stdout + logs.stderr, encoding="utf-8")
    docker("rm", "--force", "--volumes", API, MAIL, DB, check=False)
    docker("network", "rm", NET, check=False)


def wait_healthy(container: str, seconds: int = 120) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        state = docker("inspect", "--format", "{{.State.Status}} {{.State.Health.Status}}", container, check=False)
        if state.stdout.split() == ["running", "healthy"]:
            return
        time.sleep(0.5)
    raise SystemExit(f"{container} did not become healthy:\n{docker('logs', '--tail', '40', container).stderr}")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--no-build", action="store_true", help="reuse frontend/.next-e2e from a previous run")
    p.add_argument("--api-port", type=int, default=8001)
    p.add_argument("--web-port", type=int, default=3001)
    p.add_argument("--scenario", action="store_true", help="also run the Section 14 scenario (ui-audit needs it)")
    p.add_argument("--smtp-port", type=int, default=1026)
    p.add_argument("--mailpit-port", type=int, default=8026)
    args, playwright_args = p.parse_known_args()

    if docker("version", "--format", "{{.Server.Version}}", check=False).returncode != 0:
        raise SystemExit("Docker is not running: start Docker Desktop (the API runs from the backend image)")
    LOCAL.mkdir(exist_ok=True)
    # temp files in .local/, not %TEMP% (Python checks TMPDIR first, which Git Bash sets)
    env = {**os.environ, "TMPDIR": str(LOCAL), "TMP": str(LOCAL), "TEMP": str(LOCAL)}
    web_env = {
        **env,
        "NEXT_DIST_DIR": ".next-e2e",
        "API_INTERNAL_URL": f"http://127.0.0.1:{args.api_port}",
        "CRM_ENV": "local",
        "NEXT_TELEMETRY_DISABLED": "1",
    }
    next_js = ROOT / "frontend" / "node_modules" / "next" / "dist" / "bin" / "next"
    next_bin = [shutil.which("node") or "node", str(next_js)]
    procs: list[subprocess.Popen[bytes]] = []
    cleanup()  # left behind by a run that was killed before it could clean up
    try:
        docker("network", "create", NET)
        print(f"==> Throwaway PostgreSQL 16 on 127.0.0.1:{DB_PORT}, fresh database crm_e2e")
        docker(
            "run", "--detach", "--name", DB, "--network", NET, "--network-alias", "db",
            "--env", f"POSTGRES_USER={DB_USER}", "--env", f"POSTGRES_PASSWORD={DB_PASSWORD}",
            "--env", "POSTGRES_DB=postgres", "--publish", f"127.0.0.1:{DB_PORT}:5432",
            "--tmpfs", "/var/lib/postgresql/data",
            # over TCP: the image's first-time setup runs a temporary server on the Unix socket only
            "--health-cmd", f"pg_isready -h 127.0.0.1 -U {DB_USER} -d postgres",
            "--health-interval", "1s", "--health-retries", "90",
            "postgres:16-alpine",
        )  # fmt: skip
        wait_healthy(DB)
        admin_url = f"postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@127.0.0.1:{DB_PORT}/postgres"
        out = subprocess.run(
            [PY, str(ROOT / "scripts" / "local_db.py"), "--name", "crm_e2e", "--admin-url", admin_url],
            env=env, check=True, capture_output=True, text=True,
        )  # fmt: skip
        db_url = out.stdout.strip().splitlines()[-1].replace(f"127.0.0.1:{DB_PORT}", "db:5432")

        print(f"==> Mailpit on :{args.mailpit_port} (SMTP :{args.smtp_port})")
        docker(
            "run", "--detach", "--name", MAIL, "--network", NET, "--network-alias", "mailpit",
            "--publish", f"127.0.0.1:{args.mailpit_port}:8025", "--publish", f"127.0.0.1:{args.smtp_port}:1025",
            "axllent/mailpit:v1.32.0",
        )  # fmt: skip
        wait_for(f"http://127.0.0.1:{args.mailpit_port}/api/v1/info")

        print("==> Backend image (WeasyPrint + Pango)")
        docker("build", "--quiet", "--tag", IMAGE, str(ROOT / "backend"))
        api_env = {
            "CRM_DATABASE_URL": db_url,
            "CRM_ENV": "local",
            "CRM_E2E_TARGET": "true",
            "CRM_BLOB_PROVIDER": "memory",
            "CRM_VIRUS_SCAN_PROVIDER": "none",
            "CRM_COOKIE_SECURE": "false",
            "CRM_RATE_LIMIT_LOGIN": "300/minute",  # the suites sign in many times a minute from one IP
            "CRM_RATE_LIMIT_LOGIN_ACCOUNT": "60/minute",
            "CRM_RATE_LIMIT_FORGOT_IP": "300/minute",
            "CRM_RATE_LIMIT_RESET_IP": "300/minute",
            # its own Mailpit (not the demo's): reset emails of this run are read by the specs through MAILPIT_URL
            "CRM_EMAIL_PROVIDER": "smtp",
            "CRM_SMTP_HOST": "mailpit",
            "CRM_SMTP_PORT": "1025",
            "CRM_EMAIL_DISPATCH": "inline",
            "CRM_APP_BASE_URL": f"http://127.0.0.1:{args.web_port}",
        }
        print(f"==> API on :{args.api_port} (e2e target, backend image)")
        docker(
            "run", "--detach", "--name", API, "--network", NET,
            "--publish", f"127.0.0.1:{args.api_port}:8000",
            *[a for k, v in api_env.items() for a in ("--env", f"{k}={v}")],
            IMAGE, "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000",
        )  # fmt: skip
        wait_for(f"http://127.0.0.1:{args.api_port}/healthz")
        if args.scenario:
            print("==> Section 14 scenario")
            r = docker("exec", API, "python", "-m", "app.demo_cli", "--base-url", "http://127.0.0.1:8000", check=False)
            if r.returncode != 0:
                raise SystemExit(f"Section 14 scenario failed:\n{r.stdout[-1500:]}\n{r.stderr[-3000:]}")
        if not args.no_build or not (ROOT / "frontend" / ".next-e2e").exists():
            print("==> Frontend build (.next-e2e)")
            # next build rewrites two tracked files to point at its distDir: put them back so git stays clean
            kept = {f: f.read_bytes() for f in (ROOT / "frontend" / n for n in ("tsconfig.json", "next-env.d.ts"))}
            try:
                subprocess.run([*next_bin, "build"], cwd=ROOT / "frontend", env=web_env, check=True)
            finally:
                for f, content in kept.items():
                    f.write_bytes(content)
        print(f"==> Frontend on :{args.web_port}")
        web_log = open(LOCAL / "e2e-web.log", "wb")  # closed when the process exits
        procs.append(
            subprocess.Popen(
                [*next_bin, "start", "-p", str(args.web_port)],
                cwd=ROOT / "frontend",
                env=web_env,
                stdout=web_log,
                stderr=subprocess.STDOUT,
            )
        )
        wait_for(f"http://127.0.0.1:{args.web_port}/login")
        print("==> Playwright", " ".join(playwright_args))
        npx = shutil.which("npx") or "npx"
        r2 = subprocess.run(
            [npx, "playwright", "test", "--workers=1", *playwright_args],
            cwd=ROOT / "frontend",
            env={
                **os.environ,
                "E2E_BASE_URL": f"http://127.0.0.1:{args.web_port}",
                "MAILPIT_URL": f"http://127.0.0.1:{args.mailpit_port}",
            },
        )
        return r2.returncode
    finally:
        for proc in reversed(procs):
            proc.terminate()
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()
        cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
