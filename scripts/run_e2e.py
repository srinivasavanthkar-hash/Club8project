"""Run the Playwright suites against a THROWAWAY stack, never the demo database.

    python scripts/run_e2e.py                       # all suites
    python scripts/run_e2e.py passwords             # any Playwright arguments (spec filter, --project=..., -g ...)
    TOUR=1 python scripts/run_e2e.py tour passwords  # walkthrough screenshots (fictitious data)
    python scripts/run_e2e.py --no-build ...        # reuse the previous e2e frontend build

What it does (and undoes):
1. Creates a fresh database `crm_e2e` (embedded PostgreSQL in .local/, migrations, DEMO master data and users) and
   starts its own Mailpit (.local/mailpit, SMTP :1026, API :8026) for the reset emails of this run.
2. Starts the API on :8001 with CRM_E2E_TARGET=true. Specs that write data refuse to run unless the API reports it
   (frontend/e2e/support/stack.ts), so they can never touch the demo database on :8000.
3. Builds the frontend into .next-e2e (pointed at :8001) and serves it on :3001. The demo build in .next is untouched.
4. Runs Playwright against :3001, then stops the processes it started.
"""

# ruff: noqa: S603 - a developer tool that starts known local programs (python, node, npx) with fixed arguments
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


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument(
        "--no-build",
        action="store_true",
        help="reuse frontend/.next-e2e from a previous run",
    )
    p.add_argument("--api-port", type=int, default=8001)
    p.add_argument("--web-port", type=int, default=3001)
    p.add_argument(
        "--scenario",
        action="store_true",
        help="also run the Section 14 scenario (ui-audit needs it)",
    )
    p.add_argument("--smtp-port", type=int, default=1026)
    p.add_argument("--mailpit-port", type=int, default=8026)
    args, playwright_args = p.parse_known_args()

    LOCAL.mkdir(exist_ok=True)
    env = {
        **os.environ,
        "TMP": str(LOCAL),
        "TEMP": str(LOCAL),
    }  # embedded PostgreSQL lives in .local/, not %TEMP%
    print("==> Fresh database crm_e2e")
    out = subprocess.run(
        [PY, str(ROOT / "scripts" / "local_db.py"), "--name", "crm_e2e"],
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    db_url = out.stdout.strip().splitlines()[-1]

    api_env = {
        **env,
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
        "CRM_SMTP_PORT": str(args.smtp_port),
        "CRM_EMAIL_DISPATCH": "inline",
        "CRM_APP_BASE_URL": f"http://127.0.0.1:{args.web_port}",
    }
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
    try:
        mailpit = LOCAL / "mailpit" / ("mailpit.exe" if os.name == "nt" else "mailpit")
        if not mailpit.exists():
            raise SystemExit(
                f"Mailpit not found at {mailpit}: see README (Run locally without Docker)"
            )
        print(f"==> Mailpit on :{args.mailpit_port} (SMTP :{args.smtp_port})")
        procs.append(
            subprocess.Popen(
                [
                    str(mailpit),
                    "--smtp",
                    f"127.0.0.1:{args.smtp_port}",
                    "--listen",
                    f"127.0.0.1:{args.mailpit_port}",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        )
        wait_for(f"http://127.0.0.1:{args.mailpit_port}/api/v1/info")
        print(f"==> API on :{args.api_port} (e2e target)")
        api_log = open(LOCAL / "e2e-api.log", "wb")  # closed when the process exits
        procs.append(
            subprocess.Popen(
                [PY, "-m", "uvicorn", "app.main:app", "--port", str(args.api_port)],
                cwd=ROOT / "backend",
                env=api_env,
                stdout=api_log,
                stderr=subprocess.STDOUT,
            )
        )
        wait_for(f"http://127.0.0.1:{args.api_port}/healthz")
        if args.scenario:
            print("==> Section 14 scenario")
            subprocess.run(
                [
                    PY,
                    "-m",
                    "app.demo_cli",
                    "--base-url",
                    f"http://127.0.0.1:{args.api_port}",
                ],
                cwd=ROOT / "backend",
                env={**api_env, "PYTHONPATH": "."},
                check=True,
            )
        if not args.no_build or not (ROOT / "frontend" / ".next-e2e").exists():
            print("==> Frontend build (.next-e2e)")
            subprocess.run(
                [*next_bin, "build"], cwd=ROOT / "frontend", env=web_env, check=True
            )
        print(f"==> Frontend on :{args.web_port}")
        web_log = open(LOCAL / "e2e-web.log", "wb")
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
        r = subprocess.run(
            [npx, "playwright", "test", "--workers=1", *playwright_args],
            cwd=ROOT / "frontend",
            env={
                **os.environ,
                "E2E_BASE_URL": f"http://127.0.0.1:{args.web_port}",
                "MAILPIT_URL": f"http://127.0.0.1:{args.mailpit_port}",
            },
        )
        return r.returncode
    finally:
        for proc in reversed(procs):
            proc.terminate()
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
