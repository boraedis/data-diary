import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // "/" is the public landing page (#12) and "/api/public/" is its one
  // curated, masked read endpoint (see src/lib/public-profile.ts) — the
  // only two carve-outs in the auth gate beyond login itself. Every other
  // route, including the rest of "/api/", is unaffected by this and still
  // requires a session exactly as before.
  const isPublic =
    pathname === "/" ||
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/public/");

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authenticated = verifySessionToken(token);

  // An authenticated visitor hitting the public landing page should land on
  // their own dashboard instead of the public splash.
  if (pathname === "/" && authenticated) {
    return NextResponse.redirect(new URL("/home", request.url));
  }

  if (isPublic) {
    return NextResponse.next();
  }

  if (!authenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
