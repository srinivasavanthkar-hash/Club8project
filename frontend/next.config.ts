import type { NextConfig } from "next";

const API = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
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
              "frame-src 'self' blob: https://*.blob.core.windows.net http://127.0.0.1:10000 memory:; " +
              "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
          },
          // Never cache personal data at the Next.js layer.
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
