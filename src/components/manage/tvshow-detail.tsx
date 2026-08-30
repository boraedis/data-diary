"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import type { TvEpisodeItem, TvEpisodeWatchItem, TvShowCatalogItem, TvShowUsage } from "@/lib/days";
// Type-only — safe in a client component the same way movie-entry-form.tsx
// pulls TmdbMovieSearchResult in; only runtime code from tmdb.ts (which
// holds the TMDB API key) must stay server-only.
import type { TmdbSeasonSummary } from "@/lib/tmdb";

// Same convention as MovieDetail's local POSTER_BASE — see that file's
// comment for why this isn't imported from src/lib/tmdb.ts.
const POSTER_BASE = "https://image.tmdb.org/t/p/w185";

type EpisodeWithWatches = TvEpisodeItem & { watches: TvEpisodeWatchItem[] };

// One episode row inside LogEpisodeModal — shows any watches already logged
// for it plus an inline "log a watch" form, same expand-in-place pattern as
// LeagueRow/TeamRow in sport-detail.tsx.
function EpisodeRow({
  episode,
  onWatchLogged,
  onWatchDeleted,
}: {
  episode: EpisodeWithWatches;
  onWatchLogged: (episodeId: number, watch: TvEpisodeWatchItem) => void;
  onWatchDeleted: (episodeId: number, watchId: number) => void;
}) {
  const [showLogForm, setShowLogForm] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [locationType, setLocationType] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLog() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/tv-episode-watches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodeId: episode.id,
          date: date || null,
          locationType: locationType.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to log");
        return;
      }
      onWatchLogged(episode.id, body as TvEpisodeWatchItem);
      setLocationType("");
      setShowLogForm(false);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteWatch(watchId: number) {
    const res = await fetch(`/api/tv-episode-watches/${watchId}`, { method: "DELETE" });
    if (res.ok) onWatchDeleted(episode.id, watchId);
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm">
            E{episode.episode}
            {episode.name ? ` — ${episode.name}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">{episode.airDate ?? "—"}</p>
        </div>
        <Button type="button" size="xs" variant="outline" onClick={() => setShowLogForm((v) => !v)}>
          {episode.watches.length > 0
            ? `${episode.watches.length} watch${episode.watches.length === 1 ? "" : "es"}`
            : "Log watch"}
        </Button>
      </div>
      {episode.watches.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {episode.watches.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{[w.date ?? "date unknown", w.locationType].filter(Boolean).join(" · ")}</span>
              <button
                type="button"
                className="text-destructive hover:underline"
                onClick={() => handleDeleteWatch(w.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {showLogForm ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-2">
          <div className="space-y-1">
            <Label htmlFor={`ep-${episode.id}-date`} className="text-xs">
              Date
            </Label>
            <Input
              id={`ep-${episode.id}-date`}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`ep-${episode.id}-location`} className="text-xs">
              Where
            </Label>
            <Input
              id={`ep-${episode.id}-location`}
              value={locationType}
              onChange={(e) => setLocationType(e.target.value)}
              placeholder="home…"
              className="h-8"
            />
          </div>
          {error ? <span className="text-xs text-destructive">{error}</span> : null}
          <Button type="button" size="xs" onClick={handleLog} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// Season picker → episode list → per-episode "log a watch" — fetches
// lazily, only once opened (see the comment above getTvShowSeasons in
// tmdb.ts for why this isn't pre-fetched with the show). onWatchLogged
// tells the parent to router.refresh() so the "Watch history" box picks up
// the new watch from a fresh usage fetch.
function LogEpisodeModal({
  showId,
  open,
  onClose,
  onWatchLogged,
}: {
  showId: number;
  open: boolean;
  onClose: () => void;
  onWatchLogged: () => void;
}) {
  const [seasons, setSeasons] = useState<TmdbSeasonSummary[] | null>(null);
  const [loadingSeasons, setLoadingSeasons] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeWithWatches[] | null>(null);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every setState call lives inside the async IIFE (not directly in the
  // effect body) — same "defer setState out of the synchronous effect body"
  // shape as the debounced fetch in tmdb-tv-search-modal.tsx, just without
  // the debounce itself since this only fires on modal-open, not per
  // keystroke. `cancelled` guards against a stale response landing after a
  // faster season switch.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setSeasons(null);
      setSelectedSeason(null);
      setEpisodes(null);
      setError(null);
      setLoadingSeasons(true);
      try {
        const res = await fetch(`/api/tvshows/${showId}/seasons`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : "Failed to load seasons");
        setSeasons(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load seasons");
      } finally {
        if (!cancelled) setLoadingSeasons(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, showId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setEpisodes(null);
      if (selectedSeason === null) return;
      setLoadingEpisodes(true);
      setError(null);
      try {
        const res = await fetch(`/api/tvshows/${showId}/seasons/${selectedSeason}/episodes`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : "Failed to load episodes");
        setEpisodes(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load episodes");
      } finally {
        if (!cancelled) setLoadingEpisodes(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSeason, showId]);

  return (
    <Modal open={open} onClose={onClose} title="Log an episode watched">
      <div className="flex flex-col gap-3">
        {loadingSeasons ? <p className="text-sm text-muted-foreground">Loading seasons…</p> : null}
        {seasons && seasons.length > 0 ? (
          <div className="space-y-1.5">
            <Label htmlFor="log-episode-season">Season</Label>
            <Select
              id="log-episode-season"
              value={selectedSeason ?? ""}
              onChange={(e) => setSelectedSeason(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Choose a season…</option>
              {seasons.map((s) => (
                <option key={s.seasonNumber} value={s.seasonNumber}>
                  {s.name} ({s.episodeCount} episodes)
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {seasons && seasons.length === 0 ? <p className="text-sm text-muted-foreground">No seasons found.</p> : null}
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        {loadingEpisodes ? <p className="text-sm text-muted-foreground">Loading episodes…</p> : null}
        {episodes ? (
          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
            {episodes.map((ep) => (
              <EpisodeRow
                key={ep.id}
                episode={ep}
                onWatchLogged={(episodeId, watch) => {
                  setEpisodes((prev) =>
                    prev ? prev.map((e) => (e.id === episodeId ? { ...e, watches: [...e.watches, watch] } : e)) : prev
                  );
                  onWatchLogged();
                }}
                onWatchDeleted={(episodeId, watchId) => {
                  setEpisodes((prev) =>
                    prev
                      ? prev.map((e) =>
                          e.id === episodeId ? { ...e, watches: e.watches.filter((w) => w.id !== watchId) } : e
                        )
                      : prev
                  );
                  onWatchLogged();
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

// Unlike MovieDetail (fully read-only), a TV show has two things you can
// actually do here beyond delete: toggle whether you're still tracking it,
// and pull fresh status/next-episode info from TMDB — see the comment above
// TV_SHOW_COLUMNS in src/lib/days.ts for why shows need this and movies
// don't.
export function TvShowDetail({ show: initial, usage }: { show: TvShowCatalogItem; usage: TvShowUsage }) {
  const router = useRouter();
  const [show, setShow] = useState(initial);
  const [togglingInterested, setTogglingInterested] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logEpisodeOpen, setLogEpisodeOpen] = useState(false);

  async function toggleInterested() {
    setTogglingInterested(true);
    setError(null);
    try {
      const res = await fetch(`/api/tvshows/${show.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interested: !show.interested }),
      });
      if (!res.ok) throw new Error("Failed to update");
      setShow(await res.json());
    } catch {
      setError("Failed to update");
    } finally {
      setTogglingInterested(false);
    }
  }

  async function refreshFromTmdb() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/tvshows/${show.id}/refresh`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to refresh");
      setShow(await res.json());
    } catch {
      setError("Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <Link href="/manage/entertainment/tvshows" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; TV shows
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{show.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex gap-4">
            {show.posterPath ? (
              // eslint-disable-next-line @next/next/no-img-element -- external TMDB CDN image, not worth next/image's config for a personal app
              <img
                src={`${POSTER_BASE}${show.posterPath}`}
                alt=""
                className="h-36 w-24 shrink-0 rounded object-cover"
              />
            ) : null}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Status</dt>
              <dd>{show.status ?? "—"}</dd>
              <dt className="text-muted-foreground">Genres</dt>
              <dd>{show.genres.length > 0 ? show.genres.join(", ") : "—"}</dd>
              <dt className="text-muted-foreground">Next episode</dt>
              <dd>
                {show.nextEpisodeDate
                  ? `${show.nextEpisodeDate}${
                      show.nextEpisodeSeason !== null && show.nextEpisodeNumber !== null
                        ? ` (S${show.nextEpisodeSeason}E${show.nextEpisodeNumber})`
                        : ""
                    }`
                  : "—"}
              </dd>
              <dt className="text-muted-foreground">Interested</dt>
              <dd>
                {show.interested ? "Yes" : `No${show.uninterestedDate ? ` (since ${show.uninterestedDate})` : ""}`}
              </dd>
              <dt className="text-muted-foreground">Last refreshed</dt>
              <dd>{show.lastRefreshed ?? "—"}</dd>
            </dl>
          </div>

          {error ? <span className="text-sm text-destructive">{error}</span> : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={toggleInterested} disabled={togglingInterested}>
              {togglingInterested ? "Saving…" : show.interested ? "Mark not interested" : "Mark interested"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={refreshFromTmdb} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "Refresh from TMDB"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setLogEpisodeOpen(true)}>
              Log episode watched
            </Button>
          </div>

          <DeleteCatalogItem
            itemLabel={show.title}
            isBlocked={usage.watches.length > 0}
            afterDeleteHref="/manage/entertainment/tvshows"
            onDelete={async () => {
              const res = await fetch(`/api/tvshows/${show.id}`, { method: "DELETE" });
              if (!res.ok) throw new Error("Failed to delete");
            }}
            blockedContent={
              <ul className="list-inside list-disc">
                {usage.watches.map((w) => (
                  <li key={w.id}>
                    S{w.season}E{w.episode}
                    {w.episodeName ? ` — ${w.episodeName}` : ""}
                    {w.date ? ` (${w.date})` : ""}
                  </li>
                ))}
              </ul>
            }
          />
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Watch history</CardTitle>
        </CardHeader>
        <CardContent className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          {usage.watches.length === 0 ? (
            <p className="text-sm text-muted-foreground">Never watched.</p>
          ) : (
            usage.watches.map((w) => (
              <div
                key={w.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span>
                  S{w.season}E{w.episode}
                  {w.episodeName ? ` — ${w.episodeName}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {[w.date ?? "date unknown", w.locationType].filter(Boolean).join(" · ")}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <LogEpisodeModal
        showId={show.id}
        open={logEpisodeOpen}
        onClose={() => setLogEpisodeOpen(false)}
        onWatchLogged={() => router.refresh()}
      />
    </>
  );
}
