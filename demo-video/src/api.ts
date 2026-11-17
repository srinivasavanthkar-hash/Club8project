/**
 * Shared helpers for the recordings: the FICTITIOUS demo credentials, sign-in through the API, an API client for
 * set-up the video doesn't show, and date helpers. Used by record.ts (main video) and seed-clips.ts (follow-up clips).
 */
import * as OTPAuth from "otpauth";
import { type Cookie, request } from "playwright";
import { BASE } from "./stack";

export const PASSWORD = "Demo-Passw0rd!"; // FICTITIOUS demo password (backend/app/seed_demo.py)
export const DEMO_TOTP_KEY = "DEMOADMINTWOFACTORKEY234"; // FICTITIOUS demo authenticator key (seed_demo.py)
export const ROLES: Record<string, string> = {
  "demo.sales": "Sales", "demo.manager": "Management", "demo.finance": "Finance", "demo.reservations": "Reservations",
  "demo.service": "Member services", "demo.admin": "Administrator", "demo.admin2": "the second administrator",
};

/** Passwords other than the demo one: users created by the clip seed at run time (FICTITIOUS, throwaway database). */
export const PASSWORDS: Record<string, string> = {};
/** Authenticator keys by user: demo.admin's from the seed; others (demo.admin2) added by the clip seed at run time. */
export const TOTP_KEYS: Record<string, string> = { "demo.admin": DEMO_TOTP_KEY };
export const totpFor = (secret: string) => new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 }).generate();
export const totp = (user = "demo.admin") => totpFor(TOTP_KEYS[user] ?? DEMO_TOTP_KEY);

export type MasterRow = { id: string; code: string; name?: string };

async function signIn(user: string) {
  const ctx = await request.newContext({ baseURL: BASE });
  const password = PASSWORDS[user] ?? PASSWORD;
  let r = await ctx.post("/api/v1/auth/login", { data: { username: user, password } });
  if (r.status() === 401 && TOTP_KEYS[user]) r = await ctx.post("/api/v1/auth/login", { data: { username: user, password, totp_code: totp(user) } });
  if (!r.ok()) throw new Error(`sign-in for ${user} failed: ${r.status()} ${await r.text()}`);
  return ctx;
}

/** Session cookies for a role, from a sign-in through the API (visible sign-ins are shown in the recordings). */
export async function sessionCookies(user: string): Promise<Cookie[]> {
  const ctx = await signIn(user);
  const cookies = (await ctx.storageState()).cookies as Cookie[];
  await ctx.dispose();
  return cookies;
}

export type Api = Awaited<ReturnType<typeof apiAs>>;

/** API calls as a role, for set-up the video doesn't show (CSRF double-submit header included). */
export async function apiAs(user: string) {
  const ctx = await signIn(user);
  const csrf = (await ctx.storageState()).cookies.find((c) => c.name === "crm_csrf")?.value ?? "";
  const call = async <T>(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", p: string, data?: unknown): Promise<T> => {
    const res = await ctx.fetch(`/api/v1${p}`, { method, data, headers: { "X-CSRF-Token": csrf } });
    if (!res.ok()) throw new Error(`${method} ${p}: ${res.status()} ${await res.text()}`);
    return (res.status() === 204 ? undefined : await res.json()) as T;
  };
  /** multipart/form-data, e.g. a document upload */
  const upload = async <T>(p: string, fields: Record<string, string>, file: { name: string; mimeType: string; buffer: Buffer }): Promise<T> => {
    const res = await ctx.fetch(`/api/v1${p}`, { method: "POST", multipart: { ...fields, file }, headers: { "X-CSRF-Token": csrf } });
    if (!res.ok()) throw new Error(`POST ${p}: ${res.status()} ${await res.text()}`);
    return (await res.json()) as T;
  };
  const master = async (slug: string, code: string) => {
    const row = (await call<MasterRow[]>("GET", `/admin/master/${slug}`)).find((x) => x.code === code);
    if (!row) throw new Error(`master data ${slug}/${code} not found`);
    return row;
  };
  return { call, upload, master, dispose: () => ctx.dispose() };
}

// ---------------------------------------------------------------- dates (India time, ISO yyyy-mm-dd)
export const addDays = (iso: string, n: number) => new Intl.DateTimeFormat("en-CA").format(new Date(new Date(`${iso}T12:00:00`).getTime() + n * 86_400_000));
export const istMonth = (offsetDays: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + offsetDays * 86_400_000)).slice(0, 7);
export const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
export const monthName = (iso: string) => new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

/** A minimal valid PDF, for document uploads (signed agreement). */
export const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
