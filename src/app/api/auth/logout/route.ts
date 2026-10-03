import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth";

export async function POST(request: Request) {
  // 303, not NextResponse.redirect's default 307: a 307 makes the browser
  // repeat the sign-out form's POST against the target, and a POST to a
  // page route 404s (#510). Signing out lands on the public site rather
  // than a login form nobody signing out wants to see.
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    path: "/",
    maxAge: 0,
  });
  return response;
}
