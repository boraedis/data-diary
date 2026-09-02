import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";

// The public landing page (#12) and the pages it links to. "/about-project",
// "/about-me", and "/public-charts" are still stubs (see
// src/components/coming-soon-page.tsx) until #85/#86/#84 land — they're
// listed here now so an unauthenticated visitor following the hero's own
// links gets that stub instead of being funneled into the login redirect
// below, which would otherwise catch any path not explicitly public.
const PUBLIC_PATHS = new Set(["/", "/login", "/about-project", "/about-me", "/public-charts"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // "/api/public/" is the one curated, masked read endpoint (see
  // src/lib/public-profile.ts) among the public paths above — every other
  // route, including the rest of "/api/", is unaffected by this and still
  // requires a session exactly as before.
  const isPublic =
    PUBLIC_PATHS.has(pathname) || pathname.startsWith("/api/auth/") || pathname.startsWith("/api/public/");

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
