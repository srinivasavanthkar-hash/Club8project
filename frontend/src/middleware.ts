import { NextResponse, type NextRequest } from "next/server";

/** Redirect unauthenticated users to /login. Convenience only: FastAPI is the sole enforcer of permissions.
 * The refresh cookie is path-scoped to /api/v1/auth, so we check for the access OR csrf cookie here and
 * let the API client refresh an expired access token transparently. */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // public: sign-in and the password-reset pages (a reset link is opened signed out)
  if (pathname.startsWith("/login") || pathname.startsWith("/forgot-password") || pathname.startsWith("/reset-password") || pathname.startsWith("/api/") || pathname.startsWith("/_next") || pathname === "/favicon.ico" || pathname.startsWith("/brand/")) {
    return NextResponse.next();
  }
  const signedIn = req.cookies.has("crm_access") || req.cookies.has("crm_csrf");
  if (!signedIn) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"] };
