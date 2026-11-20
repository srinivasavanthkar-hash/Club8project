/**
 * The recording stack: a throwaway database `crm_video` (never the developers' `crm_local`), its own API, a
 * separately built frontend, its own Mailpit and Azurite. Started before recording, removed afterwards.
 *
 * Needs Docker. Everything except the frontend runs in containers on a private network `club8-crm-video`:
 *   Database 127.0.0.1:5433          postgres:16-alpine, data on tmpfs, removed at the end
 *   API      http://127.0.0.1:8002   the backend Docker image (WeasyPrint + Pango: the real branded PDFs; the API
 *                                    refuses to start without a PDF engine), CRM_E2E_TARGET=true, local rate limits
 *   Mailpit  http://127.0.0.1:8027   (SMTP 1027), the same image as docker-compose
 *   Azurite  http://127.0.0.1:10000  documents, the same image as docker-compose
 *   Web      http://127.0.0.1:3002   on this machine (built into frontend/.next-video; CRM_ENV unset, so no DEV
 *                                    badge, as in prod)
 * There is no worker: emails are sent by the API itself (CRM_EMAIL_DISPATCH=inline), as in the e2e runner.
 */
import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOCAL = path.join(ROOT, ".local");
export const PY = path.join(ROOT, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
export const PORTS = { api: 8002, web: 3002, mailpit: 8027, smtp: 1027, azurite: 10000, db: 5433 };
export const BASE = `http://127.0.0.1:${PORTS.web}`;
export const MAILPIT = `http://127.0.0.1:${PORTS.mailpit}`;

const NET = "club8-crm-video";
const C = { db: "club8-crm-video-db", mail: "club8-crm-video-mailpit", blob: "club8-crm-video-azurite", api: "club8-crm-video-api" };
const IMAGES = { db: "postgres:16-alpine", mail: "axllent/mailpit:v1.32.0", blob: "mcr.microsoft.com/azure-storage/azurite:3.33.0", api: "club8-crm-backend:video" };
// Development-only credentials for a database that lives for one recording; published on 127.0.0.1 only.
const VIDEO_DB = { user: "crm_owner", password: "crm_video_dev" };
// Azurite's published, well-known development key (not a secret), as in docker-compose.yml
const AZURITE_KEY = "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";

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

/** `exec`: runs a command inside the API container (same image, environment and database as the API), e.g.
 * demo-video/seed_clock.py, which generates a PDF and therefore needs the PDF engine. Returns stdout. */
export type Stack = { stop: () => void; exec: (args: string[]) => string };

function docker(args: string[]): { ok: boolean; out: string; stdout: string } {
  const r = spawnSync("docker", args, { encoding: "utf8", windowsHide: true, maxBuffer: 1 << 26 });
  return { ok: r.status === 0, stdout: r.stdout ?? "", out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() || (r.error?.message ?? "") };
}
function must(args: string[], what: string): string {
  const r = docker(args);
  if (!r.ok) throw new Error(`${what} failed:\n${r.out}`);
  return r.stdout;
}

/** Removes the recording containers and network, if any (idempotent; safe in an exit handler). The API log is kept. */
function removeAll(): void {
  if (docker(["inspect", C.api]).ok) {
    try { fs.writeFileSync(path.join(LOCAL, "video-api.log"), docker(["logs", C.api]).out); } catch { /* best effort */ }
  }
  docker(["rm", "--force", "--volumes", C.api, C.blob, C.mail, C.db]);
  docker(["network", "rm", NET]);
}

async function waitHealthy(container: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const s = docker(["inspect", "--format", "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}", container]);
    const [state, health] = s.ok ? s.out.split(/\s+/) : ["missing", ""];
    if (state === "running" && health === "healthy") return;
    if ((state !== "running" && state !== "created") || health === "unhealthy" || Date.now() > deadline) {
      throw new Error(`${container} did not become healthy (${state}${health ? `, ${health}` : ""}):\n${docker(["logs", "--tail", "40", container]).out}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function startStack(opts: { build: boolean }): Promise<Stack> {
  fs.mkdirSync(LOCAL, { recursive: true });
  if (!docker(["version", "--format", "{{.Server.Version}}"]).ok) {
    throw new Error("Docker is not running: start Docker Desktop (the recording stack runs in containers)");
  }
  const procs: ChildProcess[] = [];
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const p of procs.reverse()) { try { p.kill(); } catch { /* gone */ } }
    removeAll();
  };
  // also on Ctrl+C or a crash: the exit handler runs synchronously, so no container outlives the run
  process.once("exit", stop);
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => process.exit(130));

  try {
    removeAll(); // left behind by a run that was killed before it could clean up
    must(["network", "create", NET], "Creating the recording network");

    console.log(`==> Fresh database crm_video (migrations + DEMO seed; ${IMAGES.db} on :${PORTS.db})`);
    must([
      "run", "--detach", "--name", C.db, "--network", NET, "--network-alias", "db",
      "--env", `POSTGRES_USER=${VIDEO_DB.user}`, "--env", `POSTGRES_PASSWORD=${VIDEO_DB.password}`, "--env", "POSTGRES_DB=postgres",
      "--publish", `127.0.0.1:${PORTS.db}:5432`,
      "--tmpfs", "/var/lib/postgresql/data", // no volume: nothing survives the container
      // over TCP: during first-time setup the image runs a temporary server on the Unix socket only
      "--health-cmd", `pg_isready -h 127.0.0.1 -U ${VIDEO_DB.user} -d postgres`,
      "--health-interval", "1s", "--health-timeout", "3s", "--health-retries", "90",
      IMAGES.db,
    ], `Starting ${IMAGES.db}`);
    await waitHealthy(C.db);
    // scripts/local_db.py (host Python) runs the migrations and the DEMO seed; neither makes a PDF
    const adminUrl = `postgresql+asyncpg://${VIDEO_DB.user}:${VIDEO_DB.password}@127.0.0.1:${PORTS.db}/postgres`;
    const out = execFileSync(PY, [path.join(ROOT, "scripts", "local_db.py"), "--name", "crm_video", "--admin-url", adminUrl], { encoding: "utf8" });
    const dbUrl = out.trim().split(/\r?\n/).pop()!.replace(`127.0.0.1:${PORTS.db}`, "db:5432");

    must(["run", "--detach", "--name", C.mail, "--network", NET, "--network-alias", "mailpit",
      "--publish", `127.0.0.1:${PORTS.mailpit}:8025`, "--publish", `127.0.0.1:${PORTS.smtp}:1025`, IMAGES.mail], "Starting Mailpit");
    // Documents need a real blob endpoint the browser can open (the in-memory store hands out memory:// links).
    must(["run", "--detach", "--name", C.blob, "--network", NET, "--network-alias", "azurite",
      "--publish", `127.0.0.1:${PORTS.azurite}:10000`, IMAGES.blob,
      "azurite-blob", "--blobHost", "0.0.0.0", "--loose", "--skipApiVersionCheck"], "Starting Azurite");
    await waitFor(`${MAILPIT}/api/v1/info`);
    await waitFor(`http://127.0.0.1:${PORTS.azurite}/devstoreaccount1?comp=list`);

    console.log("==> Backend image (WeasyPrint + Pango)");
    must(["build", "--quiet", "--tag", IMAGES.api, path.join(ROOT, "backend")], "Building the backend image");
    const apiEnv: Record<string, string> = {
      CRM_DATABASE_URL: dbUrl,
      CRM_ENV: "local",
      CRM_E2E_TARGET: "true",
      CRM_BLOB_PROVIDER: "azurite",
      // links handed to the browser use the published address; the API itself talks to azurite:10000
      CRM_BLOB_ACCOUNT_URL: `http://127.0.0.1:${PORTS.azurite}/devstoreaccount1`,
      CRM_BLOB_CONNECTION_STRING: `DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=${AZURITE_KEY};BlobEndpoint=http://azurite:10000/devstoreaccount1;`,
      CRM_VIRUS_SCAN_PROVIDER: "none",
      CRM_COOKIE_SECURE: "false",
      CRM_RATE_LIMIT_LOGIN: "300/minute",
      CRM_RATE_LIMIT_LOGIN_ACCOUNT: "60/minute",
      CRM_EMAIL_PROVIDER: "smtp",
      CRM_SMTP_HOST: "mailpit",
      CRM_SMTP_PORT: "1025",
      CRM_EMAIL_DISPATCH: "inline",
      CRM_APP_BASE_URL: BASE,
      PYTHONPATH: "/app",
    };
    console.log(`==> API on :${PORTS.api} (backend image)`);
    must([
      "run", "--detach", "--name", C.api, "--network", NET, "--publish", `127.0.0.1:${PORTS.api}:8000`,
      // seed_clock.py (recording-only helper) runs inside this container: read-only, never part of the image
      "--volume", `${path.join(ROOT, "demo-video")}:/demo-video:ro`,
      ...Object.entries(apiEnv).flatMap(([k, v]) => ["--env", `${k}=${v}`]),
      IMAGES.api, "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000",
    ], "Starting the API");
    await waitFor(`http://127.0.0.1:${PORTS.api}/healthz`);
    const exec = (args: string[]): string => {
      const r = docker(["exec", "--workdir", "/app", C.api, ...args]);
      if (!r.ok) throw new Error(`${args.join(" ")} failed in the API container:\n${r.out.slice(-3000)}`);
      return r.stdout;
    };

    console.log("==> Section 14 scenario (so the dashboard has content and 9001 exists)");
    try {
      exec(["python", "-m", "app.demo_cli", "--base-url", "http://127.0.0.1:8000"]);
    } catch (e) {
      throw new Error(`Section 14 scenario failed:\n${(e as Error).message}`);
    }

    // CRM_ENV deliberately absent: the environment badge reads it per request and shows nothing when unset (prod).
    const { CRM_ENV: _ignored, ...webBase } = process.env;
    const webEnv = { ...webBase, NEXT_DIST_DIR: ".next-video", API_INTERNAL_URL: `http://127.0.0.1:${PORTS.api}`, NEXT_TELEMETRY_DISABLED: "1" };
    const next = [path.join(ROOT, "frontend", "node_modules", "next", "dist", "bin", "next")];
    if (opts.build || !fs.existsSync(path.join(ROOT, "frontend", ".next-video"))) {
      console.log("==> Frontend build (.next-video)");
      // next build rewrites two tracked files to point at its distDir: put them back so git stays clean
      const kept = ["tsconfig.json", "next-env.d.ts"].map((f) => path.join(ROOT, "frontend", f)).map((f) => [f, fs.readFileSync(f)] as const);
      try {
        execFileSync(process.execPath, [...next, "build"], { cwd: path.join(ROOT, "frontend"), env: webEnv, stdio: "ignore" });
      } finally {
        for (const [f, content] of kept) fs.writeFileSync(f, content);
      }
    }
    console.log(`==> Frontend on :${PORTS.web}`);
    const webLog = fs.openSync(path.join(LOCAL, "video-web.log"), "w");
    procs.push(spawn(process.execPath, [...next, "start", "-p", String(PORTS.web)], { cwd: path.join(ROOT, "frontend"), env: webEnv, stdio: ["ignore", webLog, webLog] }));
    await waitFor(`${BASE}/login`);
    const meta = await (await fetch(`${BASE}/api/v1/meta`)).json();
    if (!meta.e2e_target) throw new Error("The recording frontend is not talking to the recording API");
    return { stop, exec };
  } catch (e) {
    stop();
    throw e;
  }
}
