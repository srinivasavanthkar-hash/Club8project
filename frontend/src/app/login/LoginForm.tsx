"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { PasswordInput } from "@/components/PasswordInput";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { Me } from "@/lib/types";

const schema = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  totp_code: z.string().optional(),
});
type Values = z.infer<typeof schema>;

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      const me = await api.post<Me>("/auth/login", { ...v, totp_code: v.totp_code || undefined });
      qc.clear();
      // sign in -> 2FA code (if on) -> forced steps before anything else
      if (me.must_change_password) return router.replace("/change-password");
      if (me.must_enroll_totp) return router.replace("/setup-2fa");
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (e) {
      // The 2FA step is expected, not an error: the heading and hint explain it.
      if (e instanceof ApiError && e.code === "TotpRequired") return setNeedTotp(true);
      setError(e instanceof ApiError ? e.problem.detail : "Sign-in failed");
    }
  });

  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{needTotp ? "Two-step verification" : "Sign in"}</h1>
        <p className="mt-1 text-base text-fg-muted">
          {needTotp ? "Enter the 6-digit code from your authenticator app." : "Use your Club8 CRM staff account."}
        </p>
      </div>
      {params.get("reset") === "done" && !error && (
        <Alert kind="success" className="mb-4">Your password has been changed. Sign in with your new password.</Alert>
      )}
      {params.get("reason") === "session-ended" && !error && (
        <Alert kind="info" className="mb-4">Your session ended because your password or two-step verification was changed. Sign in again.</Alert>
      )}
      {/* method="post": if someone submits before the page has hydrated, the browser must never put the password
          in the address bar (and so in history and access logs) as a GET would. */}
      <form method="post" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="Username" htmlFor="username" error={formState.errors.username?.message}>
          <Input id="username" autoComplete="username" autoFocus {...register("username")} />
        </Field>
        <div className="flex flex-col gap-1">
          <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
            <PasswordInput id="password" autoComplete="current-password" {...register("password")} />
          </Field>
          {!needTotp && <Link href="/forgot-password" className="self-start text-sm text-primary underline-offset-2 hover:underline">Forgot password?</Link>}
        </div>
        {needTotp && (
          <Field label="Two-factor code" htmlFor="totp" hint="The code changes every 30 seconds.">
            <Input id="totp" inputMode="numeric" autoComplete="one-time-code" className="font-mono text-lg tracking-widest" autoFocus {...register("totp_code")} />
          </Field>
        )}
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-base text-fg">
            <KeyRound aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
            {error}
          </p>
        )}
        <Button type="submit" className="mt-1 h-10 w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
        {needTotp && (
          <Alert kind="info" className="text-sm">
            <span className="inline-flex items-center gap-1"><ShieldCheck aria-hidden className="size-4" />Two-step verification is on for this account.</span>
          </Alert>
        )}
      </form>
    </div>
  );
}
