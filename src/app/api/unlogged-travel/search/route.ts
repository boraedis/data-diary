import { NextResponse } from "next/server";
import { searchCounties } from "@/lib/geo/us-county-lookup";
import { listPickableCountries } from "@/lib/geo/country-lookup";

export const dynamic = "force-dynamic";

/**
 * Picker search for #367 — resolves what someone types to a *code*, since
 * that's what `unlogged_travel` stores and nobody should be typing a FIPS
 * by hand.
 *
 * Server-side rather than shipping the reference lists to the browser.
 * The county list is 3,231 entries with their state names, ~100KB of JSON
 * for a picker most sessions never open, and it derives from the ~842KB
 * county topology that is already loaded server-side for the spatial join.
 * Countries are only 177 and would be fine either way; they go through the
 * same endpoint so the client has one code path rather than two.
 *
 * Results are a flat `{code, primary, secondary}` shape rather than each
 * kind's own — the picker renders them identically, and giving it two
 * shapes to branch on would buy nothing.
 */
export type TravelSearchResult = {
  code: string;
  primary: string;
  secondary: string;
};

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const q = params.get("q")?.trim() ?? "";

  if (kind !== "us_county" && kind !== "country") {
    return NextResponse.json({ error: "kind must be 'us_county' or 'country'" }, { status: 400 });
  }
  if (!q) return NextResponse.json([] satisfies TravelSearchResult[]);

  if (kind === "us_county") {
    // Every match carries its own FIPS, including the six same-named
    // county/independent-city pairs — the picker shows both rows and the
    // person chooses. See searchCounties' own comment.
    const results: TravelSearchResult[] = searchCounties(q).map((c) => ({
      code: c.fips,
      primary: c.name,
      secondary: `${c.stateName} · ${c.fips}`,
    }));
    return NextResponse.json(results);
  }

  const needle = q.toLowerCase();
  // The deduped view: one row per code, so the two features sharing
  // Australia's `036` don't present as two different choices that write
  // the same value. See listPickableCountries.
  const results: TravelSearchResult[] = listPickableCountries()
    .filter((c) => c.name.toLowerCase().includes(needle))
    .slice(0, 20)
    .map((c) => ({
      code: c.code,
      // A country with no ISO code is stored under its name; say so rather
      // than showing a "code" that is just the name repeated back.
      secondary: c.hasIsoCode ? c.code : "no ISO code",
      primary: c.name,
    }));
  return NextResponse.json(results);
}
