"use client";
/* Admin account recovery (docs/PASSWORD_PROMPT.md Section 3): reset password (system-generated temporary password,
 * shown once), reset 2FA, and the second-admin approval of an ADMIN's reset. The server enforces every rule
 * (permissions, no self-reset, ADMIN approval); this UI only offers what the user may do. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, ShieldOff, ShieldAlert, UserCheck } from "lucide-react";
import * as React from "react";
import { ConfirmDialog } from "@/components/crm/States";
import { useToast } from "@/components/crm/Toast";
import { PasswordInput } from "@/components/PasswordInput";
import { ErrorText, useCan, useMe } from "@/components/providers";
import { Alert, Button, Card, Dialog, Field } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export type AdminUser = {
  id: string; username: string; full_name: string; is_active: boolean; roles: string[];
  totp_enabled: boolean; must_change_password: boolean; must_enroll_totp: boolean; locked: boolean; has_email: boolean;
};
type ResetOut = {
  status: "RESET" | "LINK_SENT" | "PENDING_APPROVAL"; link_sent_to: string | null; temporary_password: string | null; expires_at: string | null;
  request_id: string | null; approval_expires_at: string | null; super_admin_fallback: boolean;
};
export type OneTime = { username: string; password: string; expiresAt: string; context: "reset" | "new" };

/** Shows a temporary password exactly once. Closing the dialog forgets it (it is never stored or shown again). */
export function OneTimePasswordDialog({ value, onClose }: { value: OneTime | null; onClose: () => void }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => setCopied(false), [value]);
  const copy = async () => {
    if (!value) return;
    try { await navigator.clipboard.writeText(value.password); setCopied(true); } catch { setCopied(false); }
  };
  return (
    <Dialog
      open={!!value}
      onClose={onClose}
      size="sm"
      title={value?.context === "new" ? `User ${value.username} created` : `Temporary password for ${value?.username ?? ""}`}
      footer={<Button onClick={onClose}>Done, I’ve passed it on</Button>}
    >
      {value && (
        <div className="flex flex-col gap-4">
          <Alert kind="warning" title="This password won't be shown again">
            Give it to {value.username} in person or by phone. Never send it by WhatsApp, SMS or email.
          </Alert>
          <Field label="Temporary password" htmlFor="otp-value" hint={`Expires ${formatDateTime(value.expiresAt)} if unused. ${value.username} must choose a new password at sign-in.`}>
            <PasswordInput id="otp-value" autoComplete="off" readOnly value={value.password} className="font-mono" />
          </Field>
          <Button variant="outline" onClick={copy}><Copy aria-hidden />{copied ? "Copied" : "Copy password"}</Button>
        </div>
      )}
    </Dialog>
  );
}

/** Row actions for Admin -> Users. */
export function UserRecoveryActions({ user, onTemporary }: { user: AdminUser; onTemporary: (v: OneTime) => void }) {
  const can = useCan();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = React.useState<"password" | "2fa" | null>(null);
  const [method, setMethod] = React.useState<"EMAIL_LINK" | "TEMP_PASSWORD">(user.has_email ? "EMAIL_LINK" : "TEMP_PASSWORD");
  React.useEffect(() => { if (dialog === "password") setMethod(user.has_email ? "EMAIL_LINK" : "TEMP_PASSWORD"); }, [dialog, user.has_email]);
  const isAdminTarget = user.roles.includes("ADMIN");
  const resetPw = useMutation({
    mutationFn: (reason: string) => api.post<ResetOut>(`/admin/users/${user.id}/reset-password`, { reason, method }),
    onSuccess: (r) => {
      setDialog(null);
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["reset-requests"] });
      if (r.status === "PENDING_APPROVAL") toast.success(`Request sent. Another administrator must approve it by ${formatDateTime(r.approval_expires_at ?? "")}.`);
      else if (r.status === "LINK_SENT") toast.success(`Reset link sent to ${r.link_sent_to}. ${user.username} has been signed out everywhere.`);
      else onTemporary({ username: user.username, password: r.temporary_password ?? "", expiresAt: r.expires_at ?? "", context: "reset" });
    },
  });
  const reset2fa = useMutation({
    mutationFn: (reason: string) => api.post(`/admin/users/${user.id}/reset-2fa`, { reason }),
    onSuccess: () => { setDialog(null); qc.invalidateQueries({ queryKey: ["users"] }); toast.success(`Two-step verification reset for ${user.username}`); },
  });
  if (me?.id === user.id || !user.is_active) return null; // own account: Change password instead
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {can("user.reset_password") && (
        <Button size="sm" variant="ghost" onClick={() => setDialog("password")}><KeyRound aria-hidden />Reset password…</Button>
      )}
      {can("user.reset_2fa") && user.totp_enabled && (
        <Button size="sm" variant="ghost" onClick={() => setDialog("2fa")}><ShieldOff aria-hidden />Reset 2FA…</Button>
      )}
      <ConfirmDialog
        open={dialog === "password"}
        onClose={() => { setDialog(null); resetPw.reset(); }}
        onConfirm={(reason) => resetPw.mutate(reason)}
        pending={resetPw.isPending}
        title={`Reset password for ${user.username}?`}
        confirmLabel={isAdminTarget ? "Request reset" : method === "EMAIL_LINK" ? "Send reset link" : "Reset password"}
        description={
          isAdminTarget
            ? "This is an administrator account. A different administrator must approve the reset within 24 hours before anything happens."
            : "All of the user's devices are signed out now. Two-step verification is not changed."
        }
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-fg">How should {user.username} get back in?</legend>
          <label className={cn("flex cursor-pointer items-start gap-2 rounded-md border p-3", method === "EMAIL_LINK" ? "border-primary bg-primary-subtle/40" : "border-border", !user.has_email && "cursor-not-allowed opacity-60")}>
            <input type="radio" name={`m-${user.id}`} className="mt-1 accent-primary" checked={method === "EMAIL_LINK"} disabled={!user.has_email} onChange={() => setMethod("EMAIL_LINK")} />
            <span><span className="font-medium text-fg">Email a reset link</span><span className="block text-sm text-fg-muted">{user.has_email ? "Sent to their registered email. Valid for 30 minutes, works once." : "Not available: this user has no registered email."}</span></span>
          </label>
          <label className={cn("flex cursor-pointer items-start gap-2 rounded-md border p-3", method === "TEMP_PASSWORD" ? "border-primary bg-primary-subtle/40" : "border-border")}>
            <input type="radio" name={`m-${user.id}`} className="mt-1 accent-primary" checked={method === "TEMP_PASSWORD"} onChange={() => setMethod("TEMP_PASSWORD")} />
            <span><span className="font-medium text-fg">Give a temporary password</span><span className="block text-sm text-fg-muted">For users without email access. Shown to you once; you pass it on in person or by phone. Expires in 24 hours.</span></span>
          </label>
        </fieldset>
        <ErrorText error={resetPw.error} />
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "2fa"}
        onClose={() => { setDialog(null); reset2fa.reset(); }}
        onConfirm={(reason) => reset2fa.mutate(reason)}
        pending={reset2fa.isPending}
        title={`Reset two-step verification for ${user.username}?`}
        confirmLabel="Reset 2FA"
        description="Use this when the user has lost their authenticator phone. They are signed out everywhere and must set up two-step verification again at their next sign-in. Their password is not changed."
      >
        <ErrorText error={reset2fa.error} />
      </ConfirmDialog>
    </div>
  );
}

type ResetRequest = {
  id: string; target_username: string; target_full_name: string; requested_by: string; requested_by_id: string;
  reason: string; created_at: string; expires_at: string; method: "EMAIL_LINK" | "TEMP_PASSWORD";
};

/** Pending resets of ADMIN accounts, waiting for a different admin. Shown only when there are some. */
export function PendingAdminResets({ onTemporary }: { onTemporary: (v: OneTime) => void }) {
  const can = useCan();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const requests = useQuery({ queryKey: ["reset-requests"], queryFn: () => api.get<ResetRequest[]>("/admin/reset-requests"), enabled: can("user.reset_password") });
  const [decide, setDecide] = React.useState<{ req: ResetRequest; approve: boolean } | null>(null);
  const act = useMutation({
    mutationFn: ({ req, approve, reason }: { req: ResetRequest; approve: boolean; reason: string }) =>
      api.post<ResetOut | undefined>(`/admin/reset-requests/${req.id}/${approve ? "approve" : "reject"}`, { reason }),
    onSuccess: (r, v) => {
      setDecide(null);
      qc.invalidateQueries({ queryKey: ["reset-requests"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      if (r?.status === "LINK_SENT") toast.success(`Reset link sent to ${r.link_sent_to}`);
      else if (r?.temporary_password) onTemporary({ username: v.req.target_username, password: r.temporary_password, expiresAt: r.expires_at ?? "", context: "reset" });
      else toast.success(v.req.requested_by_id === me?.id ? "Request withdrawn" : "Request rejected");
    },
  });
  if (!requests.data?.length) return null;
  return (
    <Card title={<span className="inline-flex items-center gap-2"><ShieldAlert aria-hidden className="size-5 text-warning" />Administrator resets waiting for approval</span>}
      description="A reset of an administrator's password needs a second administrator. Requests expire after 24 hours.">
      <ul className="flex flex-col divide-y divide-border">
        {requests.data.map((r) => {
          const mine = r.requested_by_id === me?.id;
          return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-medium text-fg"><span className="font-mono">{r.target_username}</span> · {r.target_full_name}</p>
                <p className="text-sm text-fg-muted">{r.method === "EMAIL_LINK" ? "Reset link by email" : "Temporary password"} · requested by {r.requested_by} on {formatDateTime(r.created_at)}: “{r.reason}”. Expires {formatDateTime(r.expires_at)}.</p>
              </div>
              <div className="flex gap-2">
                {!mine && <Button size="sm" onClick={() => setDecide({ req: r, approve: true })}><UserCheck aria-hidden />Approve…</Button>}
                <Button size="sm" variant="outline" onClick={() => setDecide({ req: r, approve: false })}>{mine ? "Withdraw…" : "Reject…"}</Button>
              </div>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={!!decide}
        onClose={() => { setDecide(null); act.reset(); }}
        onConfirm={(reason) => decide && act.mutate({ ...decide, reason })}
        pending={act.isPending}
        destructive={!decide?.approve}
        title={decide?.approve ? `Approve the reset of ${decide.req.target_username}?` : `${decide?.req.requested_by_id === me?.id ? "Withdraw" : "Reject"} this request?`}
        confirmLabel={decide?.approve ? "Approve and issue password" : decide?.req.requested_by_id === me?.id ? "Withdraw" : "Reject"}
        description={decide?.approve ? (decide.req.method === "EMAIL_LINK" ? "A reset link is emailed to the administrator's registered address. They are signed out everywhere." : "A temporary password is issued and shown to you once. The administrator is signed out everywhere and must change it at sign-in.") : undefined}
      >
        <ErrorText error={act.error} />
      </ConfirmDialog>
    </Card>
  );
}
