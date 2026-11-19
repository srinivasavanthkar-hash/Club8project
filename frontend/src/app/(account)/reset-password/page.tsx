"use client";
/* Reset password from an emailed link (docs/PASSWORD_PROMPT.md Section 2).
 * - The token is read once from the address bar and removed from it at once (history.replaceState), so it does not
 *   stay in the history, bookmarks or screenshots. Pages send Referrer-Policy: no-referrer and Cache-Control: no-store.
 * - The link is checked before the form shows; invalid, used and expired links get one generic message.
 * - 2FA users must enter a current code: a reset never bypasses 2FA. The user is not signed in afterwards. */
import { ArrowLeft, CheckCircle2, KeyRound, LinkIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { usePageTitle } from "@/components/crm/Display";
import { PasswordInput } from "@/components/PasswordInput";
import { type PasswordPolicy, PolicyChecklist, StrengthMeter, checklist } from "@/components/PasswordStrength";
import { Alert, Button, Field, Input, buttonClasses } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

type Check = { valid: boolean; requires_totp: boolean; username: string | null; full_name: string | null; policy: PasswordPolicy | null };
type Problems = { code: string; message: string }[];

export default function ResetPasswordPage() {
  usePageTitle("Set a new password");
  const token = React.useRef<string | null>(null);
  const [state, setState] = React.useState<"checking" | "invalid" | "form" | "done">("checking");
  const [info, setInfo] = React.useState<Check | null>(null);
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [code, setCode] = React.useState("");
  const [problems, setProblems] = React.useState<Problems>([]);
  const [codeError, setCodeError] = React.useState<string>();
  const [error, setError] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    window.history.replaceState(null, "", "/reset-password"); // never leave the token in the address bar
    if (t) token.current = t;
    if (!token.current) { setState("invalid"); return; }
    api.post<Check>("/auth/reset-password/check", { token: token.current })
      .then((r) => { setInfo(r); setState(r.valid ? "form" : "invalid"); })
      .catch(() => setState("invalid"));
  }, []);

  const ready = !!info?.policy && checklist(next, confirm, info.policy, info.username ?? "", info.full_name ?? "").every((c) => c.ok)
    && (!info.requires_totp || code.replace(/\s+/g, "").length >= 6);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblems([]); setCodeError(undefined); setError(undefined);
    if (!ready) return setError("The new password doesn't meet the requirements yet.");
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token: token.current, new_password: next, totp_code: info?.requires_totp ? code.replace(/\s+/g, "") : undefined });
      token.current = null;
      setNext(""); setConfirm(""); setCode("");
      setState("done");
    } catch (err) {
      if (err instanceof ApiError && err.code === "PasswordPolicy") setProblems((err.problem.problems as Problems) ?? []);
      else if (err instanceof ApiError && (err.code === "TotpInvalid" || err.code === "TotpRequired")) setCodeError("That code didn't match. Enter the current 6-digit code from your app.");
      else if (err instanceof ApiError && err.code === "ResetLinkInvalid") setState("invalid");
      else setError(err instanceof ApiError ? err.problem.detail : "The password could not be changed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const card = "w-full max-w-md rounded-lg border border-border bg-surface p-6 sm:p-8";
  if (state === "checking") {
    return <section className={card} aria-busy="true"><p className="text-base text-fg-muted" role="status">Checking your link…</p></section>;
  }
  if (state === "invalid") {
    return (
      <section className={card} aria-labelledby="rp-title">
        <LinkIcon aria-hidden className="mb-3 size-8 text-fg-subtle" />
        <h1 id="rp-title" className="text-2xl font-semibold">This reset link is invalid or has expired</h1>
        <p className="mt-2 text-base text-fg-muted">Links work once and for 30 minutes, and a newer request replaces older links. Request a new one.</p>
        <Link href="/forgot-password" className={buttonClasses({ className: "mt-6 w-full" })}>Request a new link</Link>
        <Link href="/login" className={buttonClasses({ variant: "link", className: "mt-3" })}><ArrowLeft aria-hidden />Back to sign in</Link>
      </section>
    );
  }
  if (state === "done") {
    return (
      <section className={card} aria-labelledby="rp-title">
        <CheckCircle2 aria-hidden className="mb-3 size-8 text-success" />
        <h1 id="rp-title" className="text-2xl font-semibold">Your password has been changed</h1>
        <p className="mt-2 text-base text-fg-muted">You’ve been signed out everywhere. Sign in with your new password.</p>
        <Link href="/login?reset=done" className={buttonClasses({ className: "mt-6 w-full" })}>Go to sign in</Link>
      </section>
    );
  }
  return (
    <section className={card} aria-labelledby="rp-title">
      <div className="mb-6 flex items-start gap-3">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary"><KeyRound className="size-5" /></span>
        <div>
          <h1 id="rp-title" className="text-2xl font-semibold">Set a new password</h1>
          <p className="mt-1 text-base text-fg-muted">For <span className="font-mono">{info?.username}</span>. Use a long passphrase: a few unrelated words.</p>
        </div>
      </div>
      <form method="post" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <input type="text" name="username" autoComplete="username" value={info?.username ?? ""} readOnly hidden />
        <Field label="New password" htmlFor="rp-new" required error={problems.length ? problems.map((p) => p.message).join(" ") : undefined}>
          <PasswordInput id="rp-new" autoComplete="new-password" value={next} onChange={(e) => { setNext(e.target.value); setProblems([]); }} />
        </Field>
        <StrengthMeter password={next} userInputs={[info?.username ?? "", ...(info?.full_name ?? "").split(/\s+/), ...(info?.policy?.forbidden_words ?? [])]} />
        <Field label="Confirm new password" htmlFor="rp-confirm" required>
          <PasswordInput id="rp-confirm" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {info?.policy && <PolicyChecklist password={next} confirm={confirm} policy={info.policy} username={info.username ?? ""} fullName={info.full_name ?? ""} />}
        {info?.requires_totp && (
          <Field label="6-digit code from your authenticator app" htmlFor="rp-code" required error={codeError} hint="Two-step verification is on for this account.">
            <Input id="rp-code" inputMode="numeric" autoComplete="one-time-code" className="font-mono text-lg tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
        )}
        {error && <Alert kind="error">{error}</Alert>}
        <Button type="submit" className="mt-1 h-10 w-full" disabled={busy}>{busy ? "Saving…" : "Set new password"}</Button>
      </form>
    </section>
  );
}
