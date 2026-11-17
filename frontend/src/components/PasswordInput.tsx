"use client";
/* Shared password field with a show/hide toggle (docs/PASSWORD_PROMPT.md Section 1). Use it for every password field:
 * sign-in, change password, temporary passwords. Never for KYC or other masked data (those use the logged Reveal).
 *
 * - The toggle is a real <button type="button"> with aria-label, aria-pressed, aria-controls and a matching tooltip.
 * - Toggling keeps the value and the cursor position and never submits the form.
 * - The field returns to hidden after its form is submitted, when the page is hidden or restored from the
 *   back/forward cache, and on navigation (the component unmounts).
 * - "Caps Lock is on" is announced under the field while it is detected. */
import { Eye, EyeOff } from "lucide-react";
import * as React from "react";
import { Input } from "@/components/ui";
import { cn } from "@/lib/utils";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** "current-password" (sign-in, current/temporary password) or "new-password" (new password fields). */
  autoComplete: "current-password" | "new-password" | "off";
};

export const PasswordInput = React.forwardRef<HTMLInputElement, Props>(function PasswordInput(
  { id, className, onKeyDown, onKeyUp, onBlur, "aria-describedby": describedBy, ...props },
  forwarded,
) {
  const [visible, setVisible] = React.useState(false);
  const [caps, setCaps] = React.useState(false);
  const inner = React.useRef<HTMLInputElement | null>(null);
  const autoId = React.useId();
  const inputId = id ?? autoId;
  const capsId = `${inputId}-caps`;

  const setRefs = React.useCallback(
    (el: HTMLInputElement | null) => {
      inner.current = el;
      if (typeof forwarded === "function") forwarded(el);
      else if (forwarded) forwarded.current = el;
    },
    [forwarded],
  );

  React.useEffect(() => {
    const hide = () => setVisible(false);
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) hide(); };
    const form = inner.current?.form;
    form?.addEventListener("submit", hide);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", onShow);
    return () => {
      form?.removeEventListener("submit", hide);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);

  const toggle = () => {
    const el = inner.current;
    const start = el?.selectionStart ?? null;
    const end = el?.selectionEnd ?? null;
    setVisible((v) => !v);
    // Changing the input type can move the caret; put it back where it was.
    requestAnimationFrame(() => {
      if (el && start !== null && end !== null && document.activeElement === el) el.setSelectionRange(start, end);
    });
  };

  const detectCaps = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === "function") setCaps(e.getModifierState("CapsLock"));
  };

  const label = visible ? "Hide password" : "Show password";
  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <Input
          ref={setRefs}
          id={inputId}
          type={visible ? "text" : "password"}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          aria-describedby={[describedBy, caps ? capsId : null].filter(Boolean).join(" ") || undefined}
          className={cn("pr-11 touch:pr-12", className)}
          onKeyDown={(e) => { detectCaps(e); onKeyDown?.(e); }}
          onKeyUp={(e) => { detectCaps(e); onKeyUp?.(e); }}
          onBlur={(e) => { setCaps(false); onBlur?.(e); }}
          {...props}
        />
        <button
          type="button"
          onClick={toggle}
          aria-label={label}
          aria-pressed={visible}
          aria-controls={inputId}
          title={label}
          className={cn(
            "absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-fg-muted touch:w-11",
            "hover:text-fg disabled:pointer-events-none disabled:opacity-50", // focus ring: global :focus-visible
          )}
          disabled={props.disabled}
        >
          {visible ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
        </button>
      </div>
      <p id={capsId} role="status" aria-live="polite" className={cn("text-xs font-medium text-warning", !caps && "sr-only")}>
        {caps ? "Caps Lock is on" : ""}
      </p>
    </div>
  );
});
