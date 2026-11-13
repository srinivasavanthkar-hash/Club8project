"use client";
/* Change password (user menu) and the forced variant after a temporary password (must_change_password).
 * docs/PASSWORD_PROMPT.md Sections 4-5. The server checks everything; the checklist and meter are guidance. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, KeyRound, LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { usePageTitle } from "@/components/crm/Display";
import { PasswordInput } from "@/components/PasswordInput";
import { type PasswordPolicy, PolicyChecklist, StrengthMeter, checklist } from "@/components/PasswordStrength";
import { useMe } from "@/components/providers";
import { Alert, Button, Checkbox, Field, buttonClasses } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { Me } from "@/lib/types";

type Problems = { code: string; message: string }[];

export default function ChangePasswordPage() {
  usePageTitle("Change password");
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const policy = useQuery({ queryKey: ["password-policy"], queryFn: () => api.get<PasswordPolicy>("/auth/password-policy") });
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [signOutOthers, setSignOutOthers] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [currentError, setCurrentError] = React.useState<string>();
  const [problems, setProblems] = React.useState<Problems>([]);
  const [error, setError] = React.useState<string>();
  const [done, setDone] = React.useState<Me | null>(null);

  const forced = !!me?.must_change_password;
  const userInputs = me ? [me.username, ...me.full_name.split(/\s+/), ...(policy.data?.forbidden_words ?? [])] : [];
  const ready = !!policy.data && checklist(next, confirm, policy.data, me?.username ?? "", me?.full_name ?? "").every((c) => c.ok);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentError(undefined); setProblems([]); setError(undefined);
    if (!current) return setCurrentError(`Enter your ${forced ? "temporary" : "current"} password`);
    if (!ready) return setError("The new password doesn't meet the requirements yet.");
    setSubmitting(true);
    try {
      const updated = await api.post<Me>("/auth/change-password", {
        current_password: current,
        new_password: next,
        sign_out_other_devices: forced || signOutOthers,
      });
      qc.setQueryData(["me"], updated);
      setCurrent(""); setNext(""); setConfirm("");
      setDone(updated);
    } catch (err) {
      if (err instanceof ApiError && err.code === "CurrentPasswordIncorrect") setCurrentError(err.problem.detail);
      else if (err instanceof ApiError && err.code === "PasswordPolicy") setProblems((err.problem.problems as Problems) ?? []);
      else setError(err instanceof ApiError ? err.problem.detail : "The password could not be changed. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const signOut = async () => {
    await api.post("/auth/logout").catch(() => undefined);
    qc.clear();
    router.replace("/login");
  };

  if (done) {
    return (
      <section className="w-full max-w-md rounded-lg border border-border bg-surface p-6 sm:p-8" aria-labelledby="cp-title">
        <CheckCircle2 aria-hidden className="mb-3 size-8 text-success" />
        <h1 id="cp-title" className="text-2xl font-semibold">Password changed</h1>
        <p className="mt-2 text-base text-fg-muted">
          {forced || signOutOthers ? "Your other devices have been signed out. This one stays signed in." : "Your other devices stay signed in."}
        </p>
        <Button className="mt-6 w-full" onClick={() => router.replace(done.must_enroll_totp ? "/setup-2fa" : "/")}>
          {done.must_enroll_totp ? "Continue: set up two-step verification" : "Continue to the dashboard"}
        </Button>
      </section>
    );
  }

  return (
    <section className="w-full max-w-md rounded-lg border border-border bg-surface p-6 sm:p-8" aria-labelledby="cp-title">
      <div className="mb-6 flex items-start gap-3">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary"><KeyRound className="size-5" /></span>
        <div>
          <h1 id="cp-title" className="text-2xl font-semibold">{forced ? "Choose a new password" : "Change password"}</h1>
          <p className="mt-1 text-base text-fg-muted">
            {forced
              ? "You signed in with a temporary password. Choose your own password to continue."
              : "Use a long passphrase: a few unrelated words are easy to remember and hard to guess."}
          </p>
        </div>
      </div>
      {forced && me?.temp_password_expires_at && (
        <Alert kind="warning" className="mb-4">The temporary password expires on {formatDateTime(me.temp_password_expires_at)}.</Alert>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {/* hidden username so password managers save the new password against the right account */}
        <input type="text" name="username" autoComplete="username" value={me?.username ?? ""} readOnly hidden />
        <Field label={forced ? "Temporary password" : "Current password"} htmlFor="cp-current" error={currentError} required>
          <PasswordInput id="cp-current" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" htmlFor="cp-new" required error={problems.length ? problems.map((p) => p.message).join(" ") : undefined}>
          <PasswordInput id="cp-new" autoComplete="new-password" value={next} onChange={(e) => { setNext(e.target.value); setProblems([]); }} />
        </Field>
        <StrengthMeter password={next} userInputs={userInputs} />
        <Field label="Confirm new password" htmlFor="cp-confirm" required>
          <PasswordInput id="cp-confirm" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {policy.data && <PolicyChecklist password={next} confirm={confirm} policy={policy.data} username={me?.username ?? ""} fullName={me?.full_name ?? ""} />}
        {!forced && (
          <Checkbox
            label="Sign out of all other devices"
            checked={signOutOthers}
            onChange={(e) => setSignOutOthers(e.target.checked)}
          />
        )}
        {forced && <p className="text-sm text-fg-muted">For your security, any other device signed in to this account will be signed out.</p>}
        {error && <Alert kind="error">{error}</Alert>}
        <Button type="submit" className="mt-1 h-10 w-full" disabled={submitting || !me}>
          {submitting ? "Saving…" : "Change password"}
        </Button>
      </form>
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
