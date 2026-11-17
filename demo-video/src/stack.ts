/**
 * The recording stack: a throwaway database `crm_video` (never the developers' `crm_local`), its own API, a
 * separately built frontend and its own Mailpit. Started before recording, stopped afterwards.
 *
 *   API      http://127.0.0.1:8002   (CRM_E2E_TARGET=true, local rate limits for many quick sign-ins)
 *   Web      http://127.0.0.1:3002   (built into frontend/.next-video; CRM_ENV unset, so no DEV badge, as in prod)
 *   Mailpit  http://127.0.0.1:8027   (SMTP 1027)
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOCAL = path.join(ROOT, ".local");
const PY = path.join(ROOT, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
export const PORTS = { api: 8002, web: 3002, mailpit: 8027, smtp: 1027 };
export const BASE = `http://127.0.0.1:${PORTS.web}`;
export const MAILPIT = `http://127.0.0.1:${PORTS.mailpit}`;

async function waitFor(url: string, seconds = 180): Promise<void> {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export type Stack = { stop: () => void };

export async function startStack(opts: { build: boolean }): Promise<Stack> {
  fs.mkdirSync(LOCAL, { recursive: true });
  // embedded PostgreSQL lives in .local/ (Python checks TMPDIR first, which Git Bash sets)
  const dbEnv = { ...process.env, TMPDIR: LOCAL, TMP: LOCAL, TEMP: LOCAL }; // only the database helper needs this
  // Git Bash puts Git's own MinGW folders on PATH; their glib/pango DLLs clash with WeasyPrint's (receipts, vouchers)
  // and crash the API mid-request. Drop them for the processes we start.
  const env: NodeJS.ProcessEnv = { ...process.env };
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = (env[pathKey] ?? "").split(path.delimiter).filter((p) => !/[\\/]Git[\\/](mingw64|usr)[\\/]/i.test(p) && !/^\/(mingw64|usr)\//.test(p)).join(path.delimiter);
  console.log("==> Fresh database crm_video (migrations + DEMO seed)");
  const out = execFileSync(PY, [path.join(ROOT, "scripts", "local_db.py"), "--name", "crm_video"], { env: dbEnv, encoding: "utf8" });
  const dbUrl = out.trim().split(/\r?\n/).pop()!;
  const procs: ChildProcess[] = [];
  const stop = () => { for (const p of procs.reverse()) { try { p.kill(); } catch { /* gone */ } } };
  try {
    const mailpit = path.join(LOCAL, "mailpit", process.platform === "win32" ? "mailpit.exe" : "mailpit");
    procs.push(spawn(mailpit, ["--smtp", `127.0.0.1:${PORTS.smtp}`, "--listen", `127.0.0.1:${PORTS.mailpit}`], { stdio: "ignore" }));
    await waitFor(`${MAILPIT}/api/v1/info`);

    // Documents (receipts, vouchers, uploads) need a real blob endpoint the browser can open: the in-memory store
    // hands out memory:// links. Azurite (same version as docker-compose), fresh workspace per run.
    const azuriteDir = path.join(LOCAL, "azurite-video");
    fs.rmSync(azuriteDir, { recursive: true, force: true });
    fs.mkdirSync(azuriteDir, { recursive: true });
    const azurite = path.join(ROOT, "demo-video", "node_modules", "azurite", "dist", "src", "blob", "main.js");
    procs.push(spawn(process.execPath, [azurite, "--blobHost", "127.0.0.1", "--blobPort", "10000", "--location", azuriteDir, "--loose", "--skipApiVersionCheck", "--silent"], { stdio: "ignore" }));
    await waitFor("http://127.0.0.1:10000/devstoreaccount1?comp=list");

    const apiEnv = {
      ...env,
      CRM_DATABASE_URL: dbUrl,
      CRM_ENV: "local",
      CRM_E2E_TARGET: "true",
      CRM_BLOB_PROVIDER: "azurite",
      CRM_BLOB_ACCOUNT_URL: "http://127.0.0.1:10000/devstoreaccount1",
      // Azurite's published, well-known development key (not a secret), as in docker-compose.yml
      CRM_BLOB_CONNECTION_STRING:
        "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;",
      CRM_VIRUS_SCAN_PROVIDER: "none",
      CRM_COOKIE_SECURE: "false",
      CRM_RATE_LIMIT_LOGIN: "300/minute",
      CRM_RATE_LIMIT_LOGIN_ACCOUNT: "60/minute",
      CRM_EMAIL_PROVIDER: "smtp",
      CRM_SMTP_PORT: String(PORTS.smtp),
      CRM_EMAIL_DISPATCH: "inline",
      CRM_APP_BASE_URL: BASE,
    };
    console.log(`==> API on :${PORTS.api}`);
    const apiLog = fs.openSync(path.join(LOCAL, "video-api.log"), "w");
    procs.push(spawn(PY, ["-m", "uvicorn", "app.main:app", "--port", String(PORTS.api)], { cwd: path.join(ROOT, "backend"), env: apiEnv, stdio: ["ignore", apiLog, apiLog] }));
    await waitFor(`http://127.0.0.1:${PORTS.api}/healthz`);
    console.log("==> Section 14 scenario (so the dashboard has content and 9001 exists)");
    try {
      execFileSync(PY, ["-m", "app.demo_cli", "--base-url", `http://127.0.0.1:${PORTS.api}`], { cwd: path.join(ROOT, "backend"), env: { ...apiEnv, PYTHONPATH: "." }, encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      throw new Error(`Section 14 scenario failed:\n${(err.stdout ?? "").slice(-1500)}\n${(err.stderr ?? "").slice(-3000)}`);
    }

    // CRM_ENV deliberately absent: the environment badge reads it per request and shows nothing when unset (prod).
    const { CRM_ENV: _ignored, ...webBase } = env;
    const webEnv = { ...webBase, NEXT_DIST_DIR: ".next-video", API_INTERNAL_URL: `http://127.0.0.1:${PORTS.api}`, NEXT_TELEMETRY_DISABLED: "1" };
    const next = [path.join(ROOT, "frontend", "node_modules", "next", "dist", "bin", "next")];
    if (opts.build || !fs.existsSync(path.join(ROOT, "frontend", ".next-video"))) {
      console.log("==> Frontend build (.next-video)");
      execFileSync(process.execPath, [...next, "build"], { cwd: path.join(ROOT, "frontend"), env: webEnv, stdio: "ignore" });
    }
    console.log(`==> Frontend on :${PORTS.web}`);
    const webLog = fs.openSync(path.join(LOCAL, "video-web.log"), "w");
    procs.push(spawn(process.execPath, [...next, "start", "-p", String(PORTS.web)], { cwd: path.join(ROOT, "frontend"), env: webEnv, stdio: ["ignore", webLog, webLog] }));
    await waitFor(`${BASE}/login`);
    const meta = await (await fetch(`${BASE}/api/v1/meta`)).json();
    if (!meta.e2e_target) throw new Error("The recording frontend is not talking to the recording API");
    return { stop };
  } catch (e) {
    stop();
    throw e;
  }
}
