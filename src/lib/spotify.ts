// Server-only Spotify Web API wrapper — used at music-import time
// (src/lib/music-import.ts) to resolve a freshly-seen artist name to its
// Spotify genre tags (see the `genres`/`artists` table comments in
// schema.ts for why this replaces legacy's hand-curated genre/subgenre
// pair). Never import this from a "use client" component: the client
// secret must never reach the browser — same reasoning as src/lib/tmdb.ts.
//
// Spotify's app-only endpoints (search, artist lookup) use the
// "Client Credentials" OAuth flow: exchange a client id/secret for a
// short-lived bearer token, no user login involved. The token is cached
// module-level and reused until shortly before it expires, rather than
// fetched per call — this runs once per newly-seen artist during an
// import that can involve thousands of listens, so avoiding a token
// round-trip per artist matters.

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE_URL = "https://api.spotify.com/v1";

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are not set");
  }
  return { clientId, clientSecret };
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  const { clientId, clientSecret } = getCredentials();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    throw new Error(`Spotify token request failed (${res.status})`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  // Refresh a minute early rather than racing the exact expiry.
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.value;
}

// Thrown for a 404 specifically so callers that treat "not found" as a
// normal, non-fatal outcome (getArtistForTrack — a track from the user's
// history can since have been taken down) can catch just that case rather
// than string-matching the generic failure message.
class SpotifyNotFoundError extends Error {}

async function spotifyFetch<T>(path: string, params: Record<string, string>): Promise<T> {
  const token = await getAccessToken();
  const url = new URL(`${API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429) {
    // Spotify's rate-limit response — Retry-After is in seconds. A bulk
    // historical import can hit this after enough new artists; back off
    // once and retry rather than failing the whole import over it.
    const retryAfter = Number(res.headers.get("Retry-After") ?? "1");
    await new Promise((resolve) => setTimeout(resolve, (retryAfter + 1) * 1000));
    return spotifyFetch<T>(path, params);
  }
  if (res.status === 404) {
    throw new SpotifyNotFoundError(`Spotify request 404: ${path}`);
  }
  if (!res.ok) {
    throw new Error(`Spotify request failed (${res.status}): ${path}`);
  }
  return (await res.json()) as T;
}

export type SpotifyArtistMatch = { spotifyId: string; name: string; genres: string[] };

type SpotifySearchResponse = {
  artists: { items: { id: string; name: string; genres: string[] }[] };
};

function normalizeArtistName(name: string): string {
  return name.trim().toLowerCase();
}

const TRACK_URI_PREFIX = "spotify:track:";

/** Parses a `spotify_track_uri` field from a Spotify "Extended Streaming
 * History" export row (e.g. "spotify:track:6y0igZArWVi6Iz0rj35c1Y") into a
 * plain track id usable with the Web API. Returns null for anything else
 * — podcast episode rows carry a `spotify_episode_uri` instead, and very
 * old export rows may have neither. */
export function parseSpotifyTrackId(uri: unknown): string | null {
  if (typeof uri !== "string" || !uri.startsWith(TRACK_URI_PREFIX)) return null;
  const id = uri.slice(TRACK_URI_PREFIX.length);
  return id || null;
}

type SpotifyTrack = { artists: { id: string }[] };
type SpotifyArtist = { id: string; name: string; genres: string[] };

/** Exact artist lookup via the track the user actually played, rather than
 * guessing from a free-text name (see #225 — name search can silently
 * return an unrelated artist for a short/ambiguous query). The export's
 * own `spotify_track_uri` is Spotify's authoritative link from a real
 * listen to its catalog, so this is preferred over `searchArtist` whenever
 * a track id is available; `music-import.ts` falls back to `searchArtist`
 * only when it isn't (e.g. an older export format).
 *
 * Returns null — not an error — if the track (or, in principle, its
 * artist) has since been taken down from Spotify; a real listen from years
 * ago pointing at a now-removed track isn't a failure worth surfacing. */
export async function getArtistForTrack(trackId: string): Promise<SpotifyArtistMatch | null> {
  try {
    const track = await spotifyFetch<SpotifyTrack>(`/tracks/${trackId}`, {});
    const primaryArtistId = track.artists[0]?.id;
    if (!primaryArtistId) return null;
    const artist = await spotifyFetch<SpotifyArtist>(`/artists/${primaryArtistId}`, {});
    return { spotifyId: artist.id, name: artist.name, genres: artist.genres };
  } catch (error) {
    if (error instanceof SpotifyNotFoundError) return null;
    throw error;
  }
}

/** Best-effort artist lookup by name — the fallback `resolveArtist` in
 * music-import.ts uses when no `spotify_track_uri` is available for the
 * entry (see `getArtistForTrack` above for the preferred, exact path).
 * Returns null on no match rather than throwing — an unmatched artist just
 * gets no genres, not a failed import.
 *
 * Only trusts a candidate whose own name is actually the name being
 * searched for, checked across the top 10 results rather than assuming
 * index 0 is right. Confirmed on real data (#225) that Spotify's fuzzy
 * search can return a wholly unrelated top result for a short/ambiguous/
 * misspelled query — "Hanz" and "DR" both returned other real artists'
 * IDs, which then got that unrelated artist's genres silently attached.
 * Missing genres for a genuine non-match is fine (see above); silently
 * attaching a wrong artist's genres is not. */
export async function searchArtist(name: string): Promise<SpotifyArtistMatch | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const data = await spotifyFetch<SpotifySearchResponse>("/search", {
    q: trimmed,
    type: "artist",
    limit: "10",
  });
  const normalizedQuery = normalizeArtistName(trimmed);
  const match = data.artists.items.find((item) => normalizeArtistName(item.name) === normalizedQuery);
  if (!match) return null;
  return { spotifyId: match.id, name: match.name, genres: match.genres };
}
