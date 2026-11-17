"use client";
/* Password guidance shown while choosing a new password: the configured policy as a live checklist, plus a strength
 * meter (zxcvbn-ts, client-side). Guidance only: the server enforces the policy, including the breached-password and
 * reuse checks, which can only be answered on save. */
import { Check, Circle, X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export type PasswordPolicy = {
  min_length: number;
  max_length: number;
  history_count: number;
  forbidden_words: string[];
  breach_check: boolean;
};

const norm = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, "");

/** Same normalisation as the server (app/auth/policy.py): case, spaces, dots, dashes and underscores ignored. */
export function personalWords(username: string, fullName: string, forbidden: string[]): string[] {
  const parts = [username, ...forbidden, ...fullName.split(/[\s._-]+/).filter((p) => p.length >= 3), ...username.split(/[._-]+/).filter((p) => p.length >= 3)];
  return [...new Set(parts.map(norm).filter(Boolean))];
}

export function checklist(password: string, confirm: string, policy: PasswordPolicy, username: string, fullName: string) {
  const flat = norm(password);
  const personal = personalWords(username, fullName, policy.forbidden_words).some((w) => flat.includes(w));
  return [
    { id: "length", label: `At least ${policy.min_length} characters`, ok: password.length >= policy.min_length && password.length <= policy.max_length },
    { id: "personal", label: `Doesn't include your username, your name or ${policy.forbidden_words.map((w) => `"${w}"`).join(" / ")}`, ok: password.length > 0 && !personal },
    { id: "match", label: "Both entries match", ok: password.length > 0 && password === confirm },
  ];
}

type Strength = { score: 0 | 1 | 2 | 3 | 4; warning: string };
const LABELS = ["Very weak", "Weak", "Fair", "Strong", "Very strong"] as const;

let loader: Promise<(pw: string, inputs: string[]) => Strength> | null = null;
function loadZxcvbn() {
  loader ??= (async () => {
    const [{ zxcvbn, zxcvbnOptions }, common, en] = await Promise.all([
      import("@zxcvbn-ts/core"),
      import("@zxcvbn-ts/language-common"),
      import("@zxcvbn-ts/language-en"),
    ]);
    zxcvbnOptions.setOptions({
      translations: en.translations,
      graphs: common.adjacencyGraphs,
      dictionary: { ...common.dictionary, ...en.dictionary },
    });
    return (pw: string, inputs: string[]) => {
      const r = zxcvbn(pw, inputs);
      return { score: r.score, warning: r.feedback.warning ?? "" };
    };
  })();
  return loader;
}

export function StrengthMeter({ password, userInputs }: { password: string; userInputs: string[] }) {
  const [strength, setStrength] = React.useState<Strength | null>(null);
  const inputs = userInputs.join("\u0000");
  React.useEffect(() => {
    let live = true;
    if (!password) { setStrength(null); return; }
    loadZxcvbn().then((fn) => { if (live) setStrength(fn(password, inputs.split("\u0000"))); }).catch(() => undefined);
    return () => { live = false; };
  }, [password, inputs]);
  const score = strength?.score ?? -1;
  const tone = score <= 1 ? "bg-danger" : score === 2 ? "bg-warning" : "bg-success";
  return (
    <div className="flex flex-col gap-1" data-testid="strength-meter">
      <div aria-hidden className="grid grid-cols-4 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("h-1.5 rounded-full", password && i <= Math.max(score - 1, 0) && strength ? tone : "bg-surface-sunken")} />
        ))}
      </div>
      <p className="text-xs text-fg-muted">
        Strength: <span className="font-medium text-fg">{password && strength ? LABELS[strength.score] : "–"}</span>
        {strength?.warning ? <span> · {strength.warning}</span> : null}
      </p>
    </div>
  );
}

export function PolicyChecklist({
  password, confirm, policy, username, fullName,
}: { password: string; confirm: string; policy: PasswordPolicy; username: string; fullName: string }) {
  const items = checklist(password, confirm, policy, username, fullName);
  return (
    <ul className="flex flex-col gap-1 text-sm" aria-label="Password requirements">
      {items.map((it) => (
        <li key={it.id} className={cn("flex items-start gap-2", it.ok ? "text-success" : "text-fg-muted")}>
          {it.ok ? <Check aria-hidden className="mt-0.5 size-4 shrink-0" /> : password ? <X aria-hidden className="mt-0.5 size-4 shrink-0" /> : <Circle aria-hidden className="mt-0.5 size-4 shrink-0" />}
          <span>{it.label}<span className="sr-only">{it.ok ? " (met)" : " (not met yet)"}</span></span>
        </li>
      ))}
      {policy.breach_check && (
        <li className="flex items-start gap-2 text-fg-muted"><Circle aria-hidden className="mt-0.5 size-4 shrink-0" />Not found in known data breaches (checked when you save)</li>
      )}
      <li className="flex items-start gap-2 text-fg-muted"><Circle aria-hidden className="mt-0.5 size-4 shrink-0" />Not one of your last {policy.history_count} passwords (checked when you save)</li>
    </ul>
  );
}
