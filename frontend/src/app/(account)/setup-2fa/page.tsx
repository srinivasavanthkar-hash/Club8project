"use client";
/* Two-step verification set-up: voluntary (user menu) or forced after an admin "Reset 2FA" (must_enroll_totp).
 * The secret is shown only here, to the signed-in user, for their authenticator app. */
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Copy, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import * as React from "react";
import { usePageTitle } from "@/components/crm/Display";
import { useMe } from "@/components/providers";
import { Alert, Button, Field, Input, buttonClasses } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { Me } from "@/lib/types";

export default function SetupTwoFactorPage() {
  usePageTitle("Two-step verification");
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [setup, setSetup] = React.useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const started = React.useRef(false);
  const forced = !!me?.must_enroll_totp;

  const start = React.useCallback(async () => {
    if (started.current) return;
    started.current = true;
    setError(undefined);
    try {
      const r = await api.post<{ otpauth_uri: string; secret: string }>("/auth/totp/setup");
      setSetup({ qr: await QRCode.toDataURL(r.otpauth_uri, { margin: 1, width: 200 }), secret: r.secret });
    } catch (e) {
      started.current = false;
      setError(e instanceof ApiError ? e.problem.detail : "Set-up could not start. Try again.");
    }
  }, []);

  React.useEffect(() => {
    if (forced) void start();
  }, [forced, start]);

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      qc.setQueryData(["me"], await api.post<Me>("/auth/totp/confirm", { code: code.replace(/\s+/g, "") }));
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "TotpInvalid" ? "That code didn't match. Enter the current 6-digit code from the app." : err instanceof ApiError ? err.problem.detail : "Could not confirm the code.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!setup) return;
    try { await navigator.clipboard.writeText(setup.secret); setCopied(true); } catch { setCopied(false); }
  };

  const signOut = async () => {
    await api.post("/auth/logout").catch(() => undefined);
    qc.clear();
    router.replace("/login");
  };

  const card = "w-full max-w-md rounded-lg border border-border bg-surface p-6 sm:p-8";
  if (done) {
    return (
      <section className={card} aria-labelledby="tf-title">
        <CheckCircle2 aria-hidden className="mb-3 size-8 text-success" />
        <h1 id="tf-title" className="text-2xl font-semibold">Two-step verification is on</h1>
        <p className="mt-2 text-base text-fg-muted">From now on you’ll enter a code from the app each time you sign in.</p>
        <Button className="mt-6 w-full" onClick={() => router.replace("/")}>Continue to the dashboard</Button>
      </section>
    );
  }
  if (me?.totp_enabled) {
    return (
      <section className={card} aria-labelledby="tf-title">
        <ShieldCheck aria-hidden className="mb-3 size-8 text-success" />
        <h1 id="tf-title" className="text-2xl font-semibold">Two-step verification is on</h1>
        <p className="mt-2 text-base text-fg-muted">To move it to a new phone, ask an administrator to reset it. You’ll set it up again at your next sign-in.</p>
        <Link href="/" className={buttonClasses({ variant: "outline", className: "mt-6 w-full" })}>Back to the dashboard</Link>
      </section>
    );
  }
  return (
    <section className={card} aria-labelledby="tf-title">
      <div className="mb-5 flex items-start gap-3">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary"><ShieldCheck className="size-5" /></span>
        <div>
          <h1 id="tf-title" className="text-2xl font-semibold">Set up two-step verification</h1>
          <p className="mt-1 text-base text-fg-muted">
            {forced
              ? "An administrator reset your two-step verification. Set it up again to continue."
              : "Each sign-in will also ask for a code from an authenticator app on your phone."}
          </p>
        </div>
      </div>
      {!setup ? (
        <div className="flex flex-col gap-4">
          {error && <Alert kind="error">{error}</Alert>}
          {!forced && <Button onClick={() => void start()} className="w-full">Start set-up</Button>}
          {forced && !error && <p className="text-base text-fg-muted">Preparing…</p>}
        </div>
      ) : (
        <form onSubmit={confirm} className="flex flex-col gap-4" noValidate>
          <ol className="flex list-decimal flex-col gap-3 pl-5 text-base">
            <li>Open an authenticator app (for example Microsoft Authenticator or Google Authenticator).</li>
            <li>
              Scan this QR code, or enter the set-up key by hand.
              {/* eslint-disable-next-line @next/next/no-img-element -- a generated data URL */}
              <img src={setup.qr} alt="QR code to add your Club8 CRM account to an authenticator app" width={200} height={200} className="my-3 rounded-md border border-border bg-surface p-2" />
              <div className="flex items-center gap-2">
                <code className="break-all rounded-sm bg-surface-sunken px-2 py-1 font-mono text-sm" aria-label="Set-up key">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
                <Button size="sm" variant="outline" onClick={copy}><Copy aria-hidden />{copied ? "Copied" : "Copy"}</Button>
              </div>
            </li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <Field label="6-digit code" htmlFor="tf-code" required error={error}>
            <Input id="tf-code" inputMode="numeric" autoComplete="one-time-code" className="font-mono text-lg tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Button type="submit" className="h-10 w-full" disabled={busy || code.replace(/\s+/g, "").length < 6}>
            {busy ? "Checking…" : "Turn on two-step verification"}
          </Button>
        </form>
      )}
      <div className="mt-5 flex justify-between border-t border-border pt-4 text-sm">
        {forced ? (
          <button type="button" onClick={signOut} className={buttonClasses({ variant: "link" })}><LogOut aria-hidden />Sign out</button>
        ) : (
          <Link href="/" className={buttonClasses({ variant: "link" })}><ArrowLeft aria-hidden />Back to the dashboard</Link>
        )}
      </div>
    </section>
  );
}
