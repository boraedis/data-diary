"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { DurationInput } from "@/components/ui/duration-input";
import { NameCatalogField } from "@/components/entry-forms/name-catalog-field";
import { TmdbTvSearchModal } from "@/components/entry-forms/tmdb-tv-search-modal";
import { usePendingOpenMatch, type PendingOpen } from "@/lib/use-pending-open";
import type { EntertainmentLocationTypeItem } from "@/lib/catalog-admin";
import type { TvEpisodeItem, TvEpisodeWatchItem, TvShowCatalogItem } from "@/lib/days";
import type { TmdbSeasonSummary } from "@/lib/tmdb";
import { parseDate, todayDateString } from "@/lib/date";

export type TvEpisodeRow = {
  episodeId: number;
  showTitle: string;
  season: number;
  episode: number;
  episodeName: string | null;
  durationMinutes: number | null;
  locationType: string | null;
};

type EpisodeWithWatches = TvEpisodeItem & { watches: TvEpisodeWatchItem[] };

/** Most recent watch date that isn't in the future (a `null` date means
 * "watched, exact date unknown" per schema.ts's tvEpisodeWatches comment —
 * excluded here since it can't be compared for recency). Issue #67: a raw
 * watch count is less useful than "when did I last see this" for deciding
 * whether to rewatch. */
function mostRecentPastWatchDate(watches: TvEpisodeWatchItem[]): string | null {
  const today = todayDateString();
  let latest: string | null = null;
  for (const w of watches) {
    if (!w.date || w.date > today) continue;
    if (!latest || w.date > latest) latest = w.date;
  }
  return latest;
}

function formatWatchDate(dateStr: string): string {
  return parseDate(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Season picker -> checkbox episode list -> one shared Location Type +
 * per-episode duration (issue #61, "shared location, per-episode duration"
 * — confirmed with the user). Adding to local `rows` state here (not an
 * immediate POST) joins the same shared bottom Save every other kind uses,
 * unlike the Manage-side LogEpisodeModal this is modeled on (tvshow-
 * detail.tsx), which still posts immediately for its own, separate flow. */
function TvEpisodePickerModal({
  open,
  show,
  onClose,
  onSave,
  locationTypes,
  onLocationTypeCreated,
}: {
  open: boolean;
  show: TvShowCatalogItem | null;
  onClose: () => void;
  onSave: (rows: Omit<TvEpisodeRow, "showTitle">[]) => void;
  locationTypes: EntertainmentLocationTypeItem[];
  onLocationTypeCreated: (item: EntertainmentLocationTypeItem) => void;
}) {
  const [seasons, setSeasons] = useState<TmdbSeasonSummary[] | null>(null);
  const [loadingSeasons, setLoadingSeasons] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeWithWatches[] | null>(null);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<number, number | null>>(new Map());
  const [locationType, setLocationType] = useState<string | null>(null);

  // Same "setState only inside the async IIFE, guard with `cancelled`"
  // shape as LogEpisodeModal in tvshow-detail.tsx.
  useEffect(() => {
    if (!open || !show) return;
    let cancelled = false;
    (async () => {
      setSeasons(null);
      setSelectedSeason(null);
      setEpisodes(null);
      setSelected(new Map());
      setLocationType(null);
      setError(null);
      setLoadingSeasons(true);
      try {
        const res = await fetch(`/api/tvshows/${show.id}/seasons`);
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
  }, [open, show]);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    (async () => {
      setEpisodes(null);
      if (selectedSeason === null) return;
      setLoadingEpisodes(true);
      setError(null);
      try {
        const res = await fetch(`/api/tvshows/${show.id}/seasons/${selectedSeason}/episodes`);
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
  }, [selectedSeason, show]);

  function toggleEpisode(ep: EpisodeWithWatches) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(ep.id)) next.delete(ep.id);
      else next.set(ep.id, ep.runtimeMinutes);
      return next;
    });
  }

  function setEpisodeDuration(episodeId: number, minutes: number | null) {
    setSelected((prev) => new Map(prev).set(episodeId, minutes));
  }

  const selectedCount = selected.size;
  // TMDB often doesn't report a per-episode runtime, so a batch of checked
  // episodes can easily include one with no duration pre-filled and no
  // manual entry either — that single missing duration would otherwise
  // only surface as a confusing, unspecific error after Save, once it's
  // bundled with every other (fine) episode in the same day's PATCH.
  // Blocking Log here instead catches it at the exact row that needs it.
  const hasMissingDuration = [...selected.values()].some((minutes) => minutes === null);

  function handleConfirm() {
    if (!episodes) return;
    const rows: Omit<TvEpisodeRow, "showTitle">[] = [];
    for (const [episodeId, durationMinutes] of selected) {
      const ep = episodes.find((e) => e.id === episodeId);
      if (!ep) continue;
      rows.push({ episodeId, season: ep.season, episode: ep.episode, episodeName: ep.name, durationMinutes, locationType });
    }
    onSave(rows);
  }

  return (
    <Modal open={open} onClose={onClose} title={show ? `Log episodes — ${show.title}` : "Log episodes"}>
      <div className="flex flex-col gap-3">
        {loadingSeasons ? <p className="text-sm text-muted-foreground">Loading seasons…</p> : null}
        {seasons && seasons.length > 0 ? (
          <div className="space-y-1.5">
            <Label htmlFor="tv-picker-season">Season</Label>
            <Select
              id="tv-picker-season"
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
          <>
            <div className="space-y-1.5">
              <Label htmlFor="tv-picker-location">Where (applies to every episode checked below)</Label>
              <NameCatalogField
                id="tv-picker-location"
                value={locationType}
                onChange={setLocationType}
                items={locationTypes}
                onCreated={onLocationTypeCreated}
                apiPath="/api/entertainment-location-types"
                modalTitle="New location type"
              />
            </div>

            <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
              {episodes.map((ep) => {
                const isSelected = selected.has(ep.id);
                const lastWatched = mostRecentPastWatchDate(ep.watches);
                return (
                  <div key={ep.id} className="flex flex-col gap-1.5 rounded-lg border border-border px-3 py-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input accent-primary"
                        checked={isSelected}
                        onChange={() => toggleEpisode(ep)}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        E{ep.episode}
                        {ep.name ? ` — ${ep.name}` : ""}
                      </span>
                      {lastWatched ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          last watched {formatWatchDate(lastWatched)}
                        </span>
                      ) : null}
                    </label>
                    {isSelected ? (
                      <div className="flex items-center gap-2 pl-6">
                        <span className="text-xs text-muted-foreground">Watch time</span>
                        <DurationInput
                          id={`tv-picker-ep-${ep.id}-duration`}
                          totalMinutes={selected.get(ep.id) ?? null}
                          onChange={(v) => setEpisodeDuration(ep.id, v)}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <Button
              type="button"
              onClick={handleConfirm}
              disabled={selectedCount === 0 || !locationType || hasMissingDuration}
            >
              Log {selectedCount || ""} episode{selectedCount === 1 ? "" : "s"}
            </Button>
            {selectedCount > 0 && hasMissingDuration ? (
              <p className="text-xs text-muted-foreground">
                Set a watch time for every checked episode above to continue.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

/** Edits an already-logged episode watch's duration/location in place.
 * Unlike Movies/Books/Games/Other, TV rows come out of the batch
 * TvEpisodePickerModal above rather than a per-row detail modal, so there
 * was previously no way to fix a row after the fact — a real dead end once
 * duration/location became required (#64): a row saved before that (or
 * added via the picker with a duration you then decided to change) had no
 * path back to a valid state short of removing and re-adding it. */
function TvEpisodeRowEditModal({
  open,
  row,
  locationTypes,
  onLocationTypeCreated,
  onClose,
  onSave,
}: {
  open: boolean;
  row: TvEpisodeRow | null;
  locationTypes: EntertainmentLocationTypeItem[];
  onLocationTypeCreated: (item: EntertainmentLocationTypeItem) => void;
  onClose: () => void;
  onSave: (value: { durationMinutes: number | null; locationType: string | null }) => void;
}) {
  const [durationMinutes, setDurationMinutes] = useState<number | null>(row?.durationMinutes ?? null);
  const [locationType, setLocationType] = useState(row?.locationType ?? "");

  return (
    <Modal open={open} onClose={onClose} title={row ? `${row.showTitle} — S${row.season}E${row.episode}` : ""}>
      {row ? (
        <div className="flex flex-col gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="tv-row-edit-duration">Watch time</Label>
            <DurationInput id="tv-row-edit-duration" totalMinutes={durationMinutes} onChange={setDurationMinutes} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tv-row-edit-location">Where</Label>
            <NameCatalogField
              id="tv-row-edit-location"
              value={locationType || null}
              onChange={(value) => setLocationType(value ?? "")}
              items={locationTypes}
              onCreated={onLocationTypeCreated}
              apiPath="/api/entertainment-location-types"
              modalTitle="New location type"
            />
          </div>
          <Button
            type="button"
            disabled={!locationType.trim() || durationMinutes === null}
            onClick={() => onSave({ durationMinutes, locationType: locationType.trim() || null })}
          >
            Save
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}

export function TvSection({
  catalog,
  locationTypes,
  onLocationTypeCreated,
  rows,
  onRowsChange,
  pendingOpen,
}: {
  catalog: TvShowCatalogItem[];
  locationTypes: EntertainmentLocationTypeItem[];
  onLocationTypeCreated: (item: EntertainmentLocationTypeItem) => void;
  rows: TvEpisodeRow[];
  onRowsChange: (rows: TvEpisodeRow[]) => void;
  pendingOpen: PendingOpen;
}) {
  const [items, setItems] = useState<TvShowCatalogItem[]>(catalog);
  const [tmdbModalOpen, setTmdbModalOpen] = useState(false);
  const [pickerShow, setPickerShow] = useState<TvShowCatalogItem | null>(null);
  const [editIndex, setEditIndex] = useState<number | null>(null);

  const pendingShowId = usePendingOpenMatch(pendingOpen, "tv");
  if (pendingShowId !== null) {
    const show = items.find((s) => s.id === pendingShowId);
    if (show) setPickerShow(show);
  }

  function handleAdded(item: TvShowCatalogItem) {
    setItems((prev) => (prev.some((s) => s.id === item.id) ? prev : [...prev, item].sort((a, b) => a.title.localeCompare(b.title))));
    setTmdbModalOpen(false);
    setPickerShow(item);
  }

  function handleEpisodesPicked(newRows: Omit<TvEpisodeRow, "showTitle">[]) {
    if (!pickerShow) return;
    onRowsChange([...rows, ...newRows.map((r) => ({ ...r, showTitle: pickerShow.title }))]);
    setPickerShow(null);
  }

  function removeRow(index: number) {
    onRowsChange(rows.filter((_, i) => i !== index));
  }

  function saveRowEdit(value: { durationMinutes: number | null; locationType: string | null }) {
    if (editIndex === null) return;
    const next = [...rows];
    next[editIndex] = { ...next[editIndex], ...value };
    onRowsChange(next);
    setEditIndex(null);
  }

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>TV shows</CardTitle>
          <Button type="button" variant="outline" size="xs" onClick={() => setTmdbModalOpen(true)}>
            + Add from TMDB
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">None logged yet.</p> : null}
        {rows.map((row, i) => (
          <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
            <button type="button" onClick={() => setEditIndex(i)} className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm">
                {row.showTitle} — S{row.season}E{row.episode}
                {row.episodeName ? ` — ${row.episodeName}` : ""}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {row.durationMinutes ? `${row.durationMinutes} min` : <span className="text-destructive">missing watch time</span>}
                {" · "}
                {row.locationType ?? <span className="text-destructive">missing location</span>}
              </p>
            </button>
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove" onClick={() => removeRow(i)}>
              &times;
            </Button>
          </div>
        ))}
      </CardContent>

      <TmdbTvSearchModal open={tmdbModalOpen} onClose={() => setTmdbModalOpen(false)} onAdded={handleAdded} />

      <TvEpisodePickerModal
        open={pickerShow !== null}
        show={pickerShow}
        onClose={() => setPickerShow(null)}
        onSave={handleEpisodesPicked}
        locationTypes={locationTypes}
        onLocationTypeCreated={onLocationTypeCreated}
      />

      <TvEpisodeRowEditModal
        key={editIndex ?? "closed"}
        open={editIndex !== null}
        row={editIndex !== null ? rows[editIndex] : null}
        locationTypes={locationTypes}
        onLocationTypeCreated={onLocationTypeCreated}
        onClose={() => setEditIndex(null)}
        onSave={saveRowEdit}
      />
    </Card>
  );
}
