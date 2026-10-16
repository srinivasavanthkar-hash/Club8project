"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, Card, Field, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

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
      await api.post("/auth/login", { ...v, totp_code: v.totp_code || undefined });
      qc.clear();
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (e) {
      if (e instanceof ApiError && e.code === "TotpRequired") setNeedTotp(true);
      setError(e instanceof ApiError ? e.problem.detail : "Sign-in failed");
    }
  });

  return (
    <Card title="Club8 Holidays / K8 CRM" className="w-full max-w-sm">
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <Field label="Username" htmlFor="username" error={formState.errors.username?.message}>
          <Input id="username" autoComplete="username" {...register("username")} aria-invalid={!!formState.errors.username} />
        </Field>
        <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" {...register("password")} aria-invalid={!!formState.errors.password} />
        </Field>
        {needTotp && (
          <Field label="Two-factor code" htmlFor="totp">
            <Input id="totp" inputMode="numeric" autoComplete="one-time-code" {...register("totp_code")} />
          </Field>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={formState.isSubmitting}>{formState.isSubmitting ? "Signing in…" : "Sign in"}</Button>
      </form>
    </Card>
  );
}
