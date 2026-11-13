"use client";
/* CAPTCHA widget (Cloudflare Turnstile or hCaptcha), shown on "Forgot password" only after the server asks for it
 * (CaptchaRequired: several requests from the same IP). The script loads only then. The server verifies the token. */
import * as React from "react";

type Provider = "turnstile" | "hcaptcha";
type Api = { render: (el: HTMLElement, opts: Record<string, unknown>) => string };

const SCRIPTS: Record<Provider, string> = {
  turnstile: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
  hcaptcha: "https://js.hcaptcha.com/1/api.js?render=explicit",
};

function load(provider: Provider): Promise<Api> {
  const key = provider === "turnstile" ? "turnstile" : "hcaptcha";
  const existing = (window as unknown as Record<string, Api | undefined>)[key];
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPTS[provider];
    s.async = true;
    s.onload = () => {
      const api = (window as unknown as Record<string, Api | undefined>)[key];
      if (api) resolve(api); else reject(new Error("captcha unavailable"));
    };
    s.onerror = () => reject(new Error("captcha unavailable"));
    document.head.appendChild(s);
  });
}

export function Captcha({ provider, siteKey, onToken }: { provider: Provider; siteKey: string; onToken: (t: string | null) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let done = false;
    load(provider)
      .then((api) => {
        if (done || !ref.current) return;
        api.render(ref.current, {
          sitekey: siteKey,
          callback: (t: string) => onToken(t),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
      })
      .catch(() => setFailed(true));
    return () => { done = true; };
  }, [provider, siteKey, onToken]);
  return (
    <div className="flex flex-col gap-1">
      <div ref={ref} aria-label="Verification check" />
      {failed && <p className="text-sm text-danger">The verification check couldn’t load. Check your connection and reload the page.</p>}
    </div>
  );
}
