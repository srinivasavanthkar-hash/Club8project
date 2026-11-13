"use client";
/* Forgot password (docs/PASSWORD_PROMPT.md Section 2). Every submission ends on the same confirmation screen, whether
 * or not the account exists, so the page reveals nothing about accounts. */
import { ArrowLeft, MailCheck } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Captcha } from "@/components/Captcha";
import { usePageTitle } from "@/components/crm/Display";
import { Alert, Button, Field, Input, buttonClasses } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

type CaptchaNeed = { provider: "turnstile" | "hcaptcha"; siteKey: string };

export default function ForgotPasswordPage() {
  usePageTitle("Forgot password");
  const [identifier, setIdentifier] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string>();
  const [captcha, setCaptcha] = React.useState<CaptchaNeed | null>(null);
  const [captchaToken, setCaptchaToken] = React.useState<string | null>(null);
  const onToken = React.useCallback((t: string | null) => setCaptchaToken(t), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    if (!identifier.trim()) return setError("Enter your username or email address.");
    setBusy(true);
    try {
      const r = await api.post<{ message: string }>("/auth/forgot-password", { identifier: identifier.trim(), captcha_token: captchaToken ?? undefined });
      setSent(r.message);
    } catch (err) {
      if (err instanceof ApiError && err.code === "CaptchaRequired" && err.problem.site_key) {
        setCaptcha({ provider: err.problem.captcha_provider as CaptchaNeed["provider"], siteKey: String(err.problem.site_key) });
        setCaptchaToken(null);
        setError("Please complete the check below, then send again.");
      } else {
        setError(err instanceof ApiError ? err.problem.detail : "Something went wrong. Try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const card = "w-full max-w-md rounded-lg border border-border bg-surface p-6 sm:p-8";
  if (sent) {
    return (
      <section className={card} aria-labelledby="fp-title">
        <MailCheck aria-hidden className="mb-3 size-8 text-primary" />
        <h1 id="fp-title" className="text-2xl font-semibold">Check your email</h1>
        <p className="mt-2 text-base text-fg-muted">{sent}</p>
        <p className="mt-2 text-base text-fg-muted">The link works for 30 minutes. If nothing arrives, check your spam folder or ask an administrator.</p>
        <Link href="/login" className={buttonClasses({ variant: "outline", className: "mt-6 w-full" })}><ArrowLeft aria-hidden />Back to sign in</Link>
      </section>
    );
  }
  return (
    <section className={card} aria-labelledby="fp-title">
      <h1 id="fp-title" className="text-2xl font-semibold">Forgot your password?</h1>
      <p className="mt-1 text-base text-fg-muted">Enter your username or registered email address. We’ll email you a link to set a new password.</p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        <Field label="Username or email" htmlFor="fp-id" required>
          <Input id="fp-id" autoComplete="username" autoFocus value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
        </Field>
        {captcha && <Captcha provider={captcha.provider} siteKey={captcha.siteKey} onToken={onToken} />}
        {error && <Alert kind={captcha ? "info" : "error"}>{error}</Alert>}
        <Button type="submit" className="h-10 w-full" disabled={busy || (!!captcha && !captchaToken)}>{busy ? "Sending…" : "Send reset link"}</Button>
      </form>
      <p className="mt-4 text-sm text-fg-muted">No registered email, or no access to it? Ask an administrator to reset your password.</p>
      <div className="mt-5 border-t border-border pt-4">
        <Link href="/login" className={buttonClasses({ variant: "link" })}><ArrowLeft aria-hidden />Back to sign in</Link>
      </div>
    </section>
  );
}
