import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";

/**
 * Whether the current request carries a valid owner session — for public
 * pages that render for everyone but swap in an owner-only affordance (the
 * landing page's "Back to your diary" link, #510). Kept out of auth.ts so
 * that module stays free of next/headers and importable from the proxy.
 */
export async function isOwnerSession(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}
