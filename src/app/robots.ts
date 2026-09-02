import type { MetadataRoute } from "next";

// Single-user app — nothing behind the session gate is meant to be
// crawled or indexed (a crawler would just get redirected to /login
// anyway, wasting crawl budget). Only the public landing page and the
// pages it links to (#12) are meant to be found; everything else is
// disallowed by the catch-all "/" rule, with the public paths carved out
// via more-specific Allow rules (standard robots.txt precedence — the
// longest matching rule wins). Keep this in sync with proxy.ts's
// PUBLIC_PATHS/prefix checks: what's crawlable should be a subset of
// what's actually reachable without a session.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/about-project", "/about-me", "/public-charts", "/public-charts/*"],
      disallow: "/",
    },
  };
}
