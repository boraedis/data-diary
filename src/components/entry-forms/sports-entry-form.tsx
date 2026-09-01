"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { DurationInput } from "@/components/ui/duration-input";
import { SearchPanel, type SearchItem } from "@/components/entry-forms/search-panel";
import { EntertainmentLocationTypeField } from "@/components/entry-forms/entertainment-location-type-field";
import type { EntertainmentLocationTypeItem } from "@/lib/catalog-admin";
import type { DayPayload, SportCatalogItem, SportsLeagueItem, SportsPayload, SportsTeamItem } from "@/lib/days";

// The nested shape GET /api/sports actually returns — leagues and teams
// hydrated onto each sport so the picker cascade (sport -> league -> team)
// never needs a second round trip. Not exported from src/lib/days.ts as a
// named type (listSportsCatalog's return type is inline there), so it's
// composed locally from the three catalog item types that are exported.
export type SportsCatalogEntry = SportCatalogItem & { leagues: SportsLeagueItem[]; teams: SportsTeamItem[] };

type Row = {
  sportId: number;
  leagueId: number | null;
  season: string | null;
  gameType: string | null;
  homeTeamId: number | null;
  awayTeamId: number | null;
  watchedLive: boolean;
  durationMinutes: number | null;
  locationType: string | null;
};

function toSearchItem(sport: SportsCatalogEntry): SearchItem {
  return { id: sport.id, primary: sport.name, secondary: sport.isTeamSport ? null : "individual" };
}

/** "+ New sport" — mirrors NewExerciseModal (name + a small classification
 * toggle). isTeamSport decides nothing about the form below beyond framing
 * ("team" vs "individual athlete"), same as legacy's own use of the field. */
function NewSportModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (item: SportCatalogItem) => void;
}) {
  const [name, setName] = useState("");
  const [isTeamSport, setIsTeamSport] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setIsTeamSport(true);
    setError(null);
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/sports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), isTeamSport }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      onCreated(body as SportCatalogItem);
      reset();
      onClose();
    } catch {
      setError("Network error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="New sport"
    >
      <div className="flex flex-col gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="new-sport-name">Name</Label>
          <Input id="new-sport-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="size-4 rounded border-input accent-primary"
            checked={isTeamSport}
            onChange={(e) => setIsTeamSport(e.target.checked)}
          />
          Team sport (unchecked = individual athletes)
        </label>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        <Button type="button" onClick={handleCreate} disabled={creating || !name.trim()}>
          {creating ? "Adding…" : "Add"}
        </Button>
      </div>
    </Modal>
  );
}

/** "+ New league", scoped to whichever sport the watch-detail modal already
 * has open — same nested-under-a-parent shape as place subcategories. */
function NewLeagueModal({
  open,
  sportId,
  onClose,
  onCreated,
}: {
  open: boolean;
  sportId: number | null;
  onClose: () => void;
  onCreated: (item: SportsLeagueItem) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setType("");
    setError(null);
  }

  async function handleCreate() {
    if (!name.trim() || sportId === null) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/sports/${sportId}/leagues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type: type.trim() || null }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      onCreated(body as SportsLeagueItem);
      reset();
      onClose();
    } catch {
      setError("Network error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="New league"
    >
      <div className="flex flex-col gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="new-league-name">Name</Label>
          <Input id="new-league-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-league-type">Type</Label>
          <Input
            id="new-league-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="college, pro…"
          />
        </div>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        <Button type="button" onClick={handleCreate} disabled={creating || !name.trim()}>
          {creating ? "Adding…" : "Add"}
        </Button>
      </div>
    </Modal>
  );
}

/** "+ New team", scoped to the sport and (as a convenience default, not a
 * hard requirement) whichever league is already selected. */
function NewTeamModal({
  open,
  sportId,
  defaultLeagueId,
  leagues,
  onClose,
  onCreated,
}: {
  open: boolean;
  sportId: number | null;
  defaultLeagueId: number | null;
  leagues: SportsLeagueItem[];
  onClose: () => void;
  onCreated: (item: SportsTeamItem) => void;
}) {
  const [name, setName] = useState("");
  const [leagueId, setLeagueId] = useState<number | null>(defaultLeagueId);
  const [alias, setAlias] = useState("");
  const [homeLocation, setHomeLocation] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setLeagueId(defaultLeagueId);
    setAlias("");
    setHomeLocation("");
    setError(null);
  }

  async function handleCreate() {
    if (!name.trim() || sportId === null) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/sports/${sportId}/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          leagueId,
          alias: alias.trim() || null,
          homeLocation: homeLocation.trim() || null,
          color: null,
          division: null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      onCreated(body as SportsTeamItem);
      reset();
      onClose();
    } catch {
      setError("Network error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="New team"
    >
      <div className="flex flex-col gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="new-team-name">Name</Label>
          <Input id="new-team-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        {leagues.length > 0 ? (
          <div className="space-y-1.5">
            <Label htmlFor="new-team-league">League</Label>
            <Select
              id="new-team-league"
              value={leagueId ?? ""}
              onChange={(e) => setLeagueId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">No league</option>
              {leagues.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="new-team-alias">Alias</Label>
          <Input id="new-team-alias" value={alias} onChange={(e) => setAlias(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-team-location">Home location</Label>
          <Input id="new-team-location" value={homeLocation} onChange={(e) => setHomeLocation(e.target.value)} />
        </div>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        <Button type="button" onClick={handleCreate} disabled={creating || !name.trim()}>
          {creating ? "Adding…" : "Add"}
        </Button>
      </div>
    </Modal>
  );
}

/** The "log this watch" modal — opens right after a sport is picked (from
 * search or freshly created), same reuse-for-add-and-edit shape as
 * MovieDetailModal. League and both team pickers are scoped to the chosen
 * sport's own catalog entry, with a "+ New" escape hatch at each level. */
function SportsWatchDetailModal({
  open,
  sport,
  initial,
  locationTypes,
  onLocationTypeCreated,
  onClose,
  onSave,
  onLeagueCreated,
  onTeamCreated,
}: {
  open: boolean;
  sport: SportsCatalogEntry | null;
  initial: Omit<Row, "sportId"> | null;
  locationTypes: EntertainmentLocationTypeItem[];
  onLocationTypeCreated: (item: EntertainmentLocationTypeItem) => void;
  onClose: () => void;
  onSave: (value: Omit<Row, "sportId">) => void;
  onLeagueCreated: (sportId: number, league: SportsLeagueItem) => void;
  onTeamCreated: (sportId: number, team: SportsTeamItem) => void;
}) {
  const [leagueId, setLeagueId] = useState<number | null>(initial?.leagueId ?? null);
  const [homeTeamId, setHomeTeamId] = useState<number | null>(initial?.homeTeamId ?? null);
  const [awayTeamId, setAwayTeamId] = useState<number | null>(initial?.awayTeamId ?? null);
  const [season, setSeason] = useState(initial?.season ?? "");
  const [gameType, setGameType] = useState(initial?.gameType ?? "");
  const [watchedLive, setWatchedLive] = useState(initial?.watchedLive ?? false);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(initial?.durationMinutes ?? null);
  const [locationType, setLocationType] = useState(initial?.locationType ?? "");
  const [newLeagueOpen, setNewLeagueOpen] = useState(false);
  const [newTeamOpen, setNewTeamOpen] = useState(false);

  if (!sport) return null;

  return (
    <>
      <Modal open={open} onClose={onClose} title={sport.name}>
        <div className="flex flex-col gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="sports-detail-league">League</Label>
              <Button type="button" variant="ghost" size="xs" onClick={() => setNewLeagueOpen(true)}>
                + New
              </Button>
            </div>
            <Select
              id="sports-detail-league"
              value={leagueId ?? ""}
              onChange={(e) => setLeagueId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">None</option>
              {sport.leagues.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="sports-detail-home">{sport.isTeamSport ? "Home team" : "Athlete"}</Label>
              <Button type="button" variant="ghost" size="xs" onClick={() => setNewTeamOpen(true)}>
                + New
              </Button>
            </div>
            <Select
              id="sports-detail-home"
              value={homeTeamId ?? ""}
              onChange={(e) => setHomeTeamId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">None</option>
              {sport.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>

          {sport.isTeamSport ? (
            <div className="space-y-1.5">
              <Label htmlFor="sports-detail-away">Away team</Label>
              <Select
                id="sports-detail-away"
                value={awayTeamId ?? ""}
                onChange={(e) => setAwayTeamId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">None</option>
                {sport.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sports-detail-season">Season</Label>
              <Input id="sports-detail-season" value={season} onChange={(e) => setSeason(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sports-detail-gametype">Game type</Label>
              <Input
                id="sports-detail-gametype"
                value={gameType}
                onChange={(e) => setGameType(e.target.value)}
                placeholder="regular, playoff…"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 rounded border-input accent-primary"
              checked={watchedLive}
              onChange={(e) => setWatchedLive(e.target.checked)}
            />
            Watched live
          </label>

          <div className="space-y-1.5">
            <Label htmlFor="sports-detail-duration">Duration</Label>
            <DurationInput id="sports-detail-duration" totalMinutes={durationMinutes} onChange={setDurationMinutes} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sports-detail-location">Where</Label>
            <EntertainmentLocationTypeField
              id="sports-detail-location"
              value={locationType || null}
              onChange={(value) => setLocationType(value ?? "")}
              items={locationTypes}
              onCreated={onLocationTypeCreated}
              placeholder="stadium, home…"
            />
          </div>

          <Button
            type="button"
            onClick={() =>
              onSave({
                leagueId,
                homeTeamId,
                awayTeamId,
                season: season.trim() || null,
                gameType: gameType.trim() || null,
                watchedLive,
                durationMinutes,
                locationType: locationType.trim() || null,
              })
            }
          >
            Save
          </Button>
        </div>
      </Modal>

      <NewLeagueModal
        open={newLeagueOpen}
        sportId={sport.id}
        onClose={() => setNewLeagueOpen(false)}
        onCreated={(league) => {
          onLeagueCreated(sport.id, league);
          setLeagueId(league.id);
        }}
      />
      <NewTeamModal
        open={newTeamOpen}
        sportId={sport.id}
        defaultLeagueId={leagueId}
        leagues={sport.leagues}
        onClose={() => setNewTeamOpen(false)}
        onCreated={(team) => {
          onTeamCreated(sport.id, team);
          if (homeTeamId === null) setHomeTeamId(team.id);
          else setAwayTeamId(team.id);
        }}
      />
    </>
  );
}

export function SportsEntryForm({
  date,
  initial,
  catalog,
  locationTypes: initialLocationTypes,
}: {
  date: string;
  initial: DayPayload["sportsWatches"];
  catalog: SportsCatalogEntry[];
  locationTypes: EntertainmentLocationTypeItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<SportsCatalogEntry[]>(catalog);
  const [rows, setRows] = useState<Row[]>(
    initial.map((w) => ({
      sportId: w.sportId,
      leagueId: w.leagueId,
      season: w.season,
      gameType: w.gameType,
      homeTeamId: w.homeTeamId,
      awayTeamId: w.awayTeamId,
      watchedLive: w.watchedLive,
      durationMinutes: w.durationMinutes,
      locationType: w.locationType,
    }))
  );
  const [locationTypes, setLocationTypes] = useState(initialLocationTypes);
  const [newSportOpen, setNewSportOpen] = useState(false);
  const [detail, setDetail] = useState<{ sport: SportsCatalogEntry; editIndex: number | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const editingRow = detail?.editIndex !== null && detail?.editIndex !== undefined ? rows[detail.editIndex] : null;

  function updateCatalogSport(sportId: number, updater: (s: SportsCatalogEntry) => SportsCatalogEntry) {
    setItems((prev) => prev.map((s) => (s.id === sportId ? updater(s) : s)));
    setDetail((prev) => (prev && prev.sport.id === sportId ? { ...prev, sport: updater(prev.sport) } : prev));
  }

  function handleSportCreated(item: SportCatalogItem) {
    const entry: SportsCatalogEntry = { ...item, leagues: [], teams: [] };
    setItems((prev) => [...prev, entry].sort((a, b) => a.name.localeCompare(b.name)));
    setNewSportOpen(false);
    setDetail({ sport: entry, editIndex: null });
  }

  function handleLeagueCreated(sportId: number, league: SportsLeagueItem) {
    updateCatalogSport(sportId, (s) => ({ ...s, leagues: [...s.leagues, league] }));
  }

  function handleTeamCreated(sportId: number, team: SportsTeamItem) {
    updateCatalogSport(sportId, (s) => ({ ...s, teams: [...s.teams, team] }));
  }

  function openForPick(id: number) {
    const sport = items.find((s) => s.id === id);
    if (!sport) return;
    setDetail({ sport, editIndex: null });
  }

  function openForEdit(index: number) {
    const row = rows[index];
    const sport = items.find((s) => s.id === row.sportId);
    if (!sport) return;
    setDetail({ sport, editIndex: index });
  }

  function saveDetail(value: Omit<Row, "sportId">) {
    if (!detail) return;
    setSavedAt(null);
    setRows((prev) => {
      if (detail.editIndex !== null) {
        const next = [...prev];
        next[detail.editIndex] = { sportId: detail.sport.id, ...value };
        return next;
      }
      return [...prev, { sportId: detail.sport.id, ...value }];
    });
    setDetail(null);
  }

  function removeRow(index: number) {
    setSavedAt(null);
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function describeRow(row: Row): string {
    const sport = items.find((s) => s.id === row.sportId);
    const home = items.flatMap((s) => s.teams).find((t) => t.id === row.homeTeamId);
    const away = items.flatMap((s) => s.teams).find((t) => t.id === row.awayTeamId);
    const parts = [
      sport?.name ?? "Unknown",
      home && away ? `${home.name} vs ${away.name}` : (home?.name ?? away?.name ?? null),
      row.season,
      row.watchedLive ? "live" : null,
    ].filter(Boolean);
    return parts.join(" · ");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const payload: SportsPayload = { entries: rows };

    try {
      const res = await fetch(`/api/days/${date}/sports`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }

      const saved = body as DayPayload;
      setRows(
        saved.sportsWatches.map((w) => ({
          sportId: w.sportId,
          leagueId: w.leagueId,
          season: w.season,
          gameType: w.gameType,
          homeTeamId: w.homeTeamId,
          awayTeamId: w.awayTeamId,
          watchedLive: w.watchedLive,
          durationMinutes: w.durationMinutes,
          locationType: w.locationType,
        }))
      );
      setSavedAt(Date.now());
      router.refresh();
    } catch {
      setError("Network error — could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 pb-20">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Sports</CardTitle>
          <CardDescription>
            {rows.length === 0 ? "None logged yet." : `${rows.length} logged.`} Search a sport you&apos;ve watched
            before, or add a new one.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rows.length > 0 ? (
            <div className="flex flex-col gap-2">
              {rows.map((row, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <button type="button" onClick={() => openForEdit(i)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm">{describeRow(row)}</p>
                  </button>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove" onClick={() => removeRow(i)}>
                    &times;
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Add a sport</Label>
              <Button type="button" variant="outline" size="xs" onClick={() => setNewSportOpen(true)}>
                + New sport
              </Button>
            </div>
            <SearchPanel
              items={items.map(toSearchItem)}
              onSelect={openForPick}
              placeholder="Search sports you've logged before…"
              emptyMessage="No matches — try “+ New sport”."
            />
          </div>
        </CardContent>
      </Card>

      <NewSportModal open={newSportOpen} onClose={() => setNewSportOpen(false)} onCreated={handleSportCreated} />

      <SportsWatchDetailModal
        key={detail ? `${detail.sport.id}-${detail.editIndex ?? "new"}` : "closed"}
        open={detail !== null}
        sport={detail?.sport ?? null}
        initial={editingRow ?? null}
        locationTypes={locationTypes}
        onLocationTypeCreated={(item) =>
          setLocationTypes((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))
        }
        onClose={() => setDetail(null)}
        onSave={saveDetail}
        onLeagueCreated={handleLeagueCreated}
        onTeamCreated={handleTeamCreated}
      />

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-3 md:max-w-2xl">
          <span className="text-sm">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : savedAt ? (
              <span className="text-muted-foreground">Saved.</span>
            ) : null}
          </span>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}
