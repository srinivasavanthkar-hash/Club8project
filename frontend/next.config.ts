import type { NextConfig } from "next";

const API = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // scripts/run_e2e.py builds a separate copy (.next-e2e, pointed at the throwaway e2e API) so the demo build is untouched
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // Brand logos and icons are served as the plain files in public/brand. Next's image optimiser once hung on the
  // first conversion of an icon and every later request for it waited (Phase 2 report); the files are small and
  // used as supplied, so there is nothing to optimise. e2e/login-load.spec.ts fails if the login page or its images
  // take longer than 2 seconds.
  images: { unoptimized: true },
  // Same-origin API: the browser calls /api/v1/* on this origin and Next.js forwards to FastAPI.
  // httpOnly auth cookies stay first-party and no CORS is needed. FastAPI is not publicly exposed.
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${API}/api/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; img-src 'self' data: blob: https://*.blob.core.windows.net http://127.0.0.1:10000; " +
              // CAPTCHA providers (Forgot password, only after repeated requests): Turnstile and hCaptcha
              "frame-src 'self' blob: https://*.blob.core.windows.net http://127.0.0.1:10000 memory: https://challenges.cloudflare.com https://*.hcaptcha.com https://hcaptcha.com; " +
              "style-src 'self' 'unsafe-inline' https://*.hcaptcha.com https://hcaptcha.com; " +
              "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://js.hcaptcha.com https://*.hcaptcha.com; " +
              "connect-src 'self' https://*.hcaptcha.com https://hcaptcha.com; frame-ancestors 'none'",
          },
          // Never cache personal data at the Next.js layer.
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      // Brand files are public artwork, never personal data: browsers may keep them for a day (overrides no-store)
      { source: "/brand/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
    ];
  },
};

export default nextConfig;
