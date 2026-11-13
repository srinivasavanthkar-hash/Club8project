/** Fetch wrapper for the same-origin FastAPI (/api/v1). Adds the CSRF header on unsafe methods and turns
 * RFC 7807 problem responses into ApiError. No personal data is cached outside TanStack Query memory. */

export type Problem = {
  type?: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  errors?: { loc: (string | number)[]; msg: string }[];
  matches?: { ref: string; kind: string; reasons: string[] }[];
  blockers?: string[];
  warnings?: string[];
  [k: string]: unknown;
};

export class ApiError extends Error {
  constructor(public problem: Problem) {
    super(problem.detail || problem.title);
  }
  get status() {
    return this.problem.status;
  }
  get code() {
    return this.problem.code;
  }
}

function csrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)crm_csrf=([^;]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : "";
}

type Opts = { headers?: Record<string, string>; signal?: AbortSignal };

// 401s from these are answers (wrong password, 2FA needed), not an expired session
const NO_REFRESH = new Set([
  "/auth/login", "/auth/refresh", "/auth/change-password",
  "/auth/forgot-password", "/auth/reset-password", "/auth/reset-password/check",
]);
export const FORCED_STEPS: Record<string, string> = {
  PasswordChangeRequired: "/change-password",
  TotpEnrolmentRequired: "/setup-2fa",
};

async function request<T>(method: string, path: string, body?: unknown, opts: Opts = {}): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  if (method !== "GET") headers["X-CSRF-Token"] = csrfToken();
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
    signal: opts.signal,
  });
  if (res.status === 401 && !NO_REFRESH.has(path)) {
    // A session ended on purpose (password changed or reset elsewhere, 2FA reset) cannot be refreshed: say why.
    const ended = (await res.clone().json().catch(() => null))?.code === "SessionRevoked";
    if (!ended) {
      const refreshed = await fetch("/api/v1/auth/refresh", { method: "POST", credentials: "same-origin" });
      if (refreshed.ok) return request<T>(method, path, body, opts);
    }
    if (typeof window !== "undefined") {
      window.location.href = `/login?next=${encodeURIComponent(location.pathname)}${ended ? "&reason=session-ended" : ""}`;
    }
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    const p: Problem =
      typeof data === "object" && data
        ? (data as Problem)
        : { title: res.statusText, status: res.status, detail: String(data), code: "HttpError" };
    // Forced account steps: the server refuses everything else, so take the user to the step itself.
    const step = FORCED_STEPS[p.code];
    if (res.status === 403 && step && typeof window !== "undefined" && location.pathname !== step) {
      window.location.href = step;
    }
    throw new ApiError(p);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, params?: Record<string, unknown>, opts?: Opts) =>
    request<T>("GET", params ? `${path}?${qs(params)}` : path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: Opts) => request<T>("POST", path, body ?? {}, opts),
  patch: <T>(path: string, body: unknown, opts?: Opts) => request<T>("PATCH", path, body, opts),
  put: <T>(path: string, body: unknown, opts?: Opts) => request<T>("PUT", path, body, opts),
};

export function qs(params: Record<string, unknown>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => u.append(k, String(x)));
    else u.append(k, String(v));
  }
  return u.toString();
}

export type Page<T> = { items: T[]; total: number; page: number; page_size: number };
