"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { DurationInput } from "@/components/ui/duration-input";
import { NameCatalogField } from "@/components/entry-forms/name-catalog-field";
import { usePendingOpenMatch, type PendingOpen } from "@/lib/use-pending-open";
import type { EntertainmentLocationTypeItem, SportsGameTypeItem, SportsSeasonItem } from "@/lib/catalog-admin";
import type { SportCatalogItem, SportsLeagueItem, SportsTeamItem } from "@/lib/days";

// The nested shape GET /api/sports actually returns — leagues and teams
// hydrated onto each sport so the picker cascade (sport -> league -> team)
// never needs a second round trip.
export type SportsCatalogEntry = SportCatalogItem & { leagues: SportsLeagueItem[]; teams: SportsTeamItem[] };

export type SportsRow = {
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

// Home/away team options grouped by league (issue #61) — the currently
// selected league's teams first (unlabeled, since that's the group you're
// actually choosing from), then every other league as its own labeled
// group (alphabetical), then any team with no league last.
function groupTeamsByLeague(teams: SportsTeamItem[], leagues: SportsLeagueItem[], selectedLeagueId: number | null) {
  const byLeague = new Map<number | null, SportsTeamItem[]>();
  for (const t of teams) {
    const list = byLeague.get(t.leagueId) ?? [];
    list.push(t);
    byLeague.set(t.leagueId, list);
  }
  const sortedLeagues = [...leagues].sort((a, b) => a.name.localeCompare(b.name));
  const otherLeagues = sortedLeagues.filter((l) => l.id !== selectedLeagueId);
  const selectedLeague = sortedLeagues.find((l) => l.id === selectedLeagueId) ?? null;
  return {
    selected: selectedLeague ? (byLeague.get(selectedLeague.id) ?? []) : [],
    selectedLeague,
    other: otherLeagues.map((l) => ({ league: l, teams: byLeague.get(l.id) ?? [] })).filter((g) => g.teams.length > 0),
    unassigned: byLeague.get(null) ?? [],
  };
}

function TeamSelect({
  id,
  label,
  value,
  onChange,
  teams,
  leagues,
  selectedLeagueId,
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (id: number | null) => void;
  teams: SportsTeamItem[];
  leagues: SportsLeagueItem[];
  selectedLeagueId: number | null;
}) {
  const grouped = groupTeamsByLeague(teams, leagues, selectedLeagueId);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">None</option>
        {grouped.selected.length > 0 ? (
          <optgroup label={grouped.selectedLeague?.name ?? "This league"}>
            {grouped.selected.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {grouped.other.map(({ league, teams: leagueTeams }) => (
          <optgroup key={league.id} label={league.name}>
            {leagueTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
        ))}
        {grouped.unassigned.length > 0 ? (
          <optgroup label="No league">
            {grouped.unassigned.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </Select>
    </div>
  );
}

/** "+ New sport" — a fallback for a sport with no leagues cataloged yet
 * (the unified search only surfaces leagues, per issue #61 — a sport needs
 * at least one league before it's reachable that way). */
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
          <Input id="new-league-type" value={type} onChange={(e) => setType(e.target.value)} placeholder="college, pro…" />
        </div>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        <Button type="button" onClick={handleCreate} disabled={creating || !name.trim()}>
          {creating ? "Adding…" : "Add"}
        </Button>
      </div>
    </Modal>
  );
}

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

/** "+ New season", scoped to whichever league is currently selected in the
 * parent modal — same nested-under-a-parent shape as NewLeagueModal itself. */
function NewSeasonModal({
  open,
  leagueId,
  onClose,
  onCreated,
}: {
  open: boolean;
  leagueId: number | null;
  onClose: () => void;
  onCreated: (item: SportsSeasonItem) => void;
}) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setError(null);
  }

  async function handleCreate() {
    if (!name.trim() || leagueId === null) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/sports-leagues/${leagueId}/seasons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      onCreated(body as SportsSeasonItem);
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
      title="New season"
    >
      <div className="flex flex-col gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="new-sports-season-name">Name</Label>
          <Input
            id="new-sports-season-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 2023-24"
            autoFocus
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

/** The "log this watch" modal — opens the moment a league is picked (from
 * the unified search) or the sport-only "+ New sport" fallback, and is also
 * how an already-logged watch gets edited. Season is scoped to whichever
 * league is currently chosen (same cross-filtering SleepLocationField uses
 * for type -> subtype); Game type is a flat catalog like Location Type. */
function SportsWatchDetailModal({
  open,
  sport,
  initial,
  initialLeagueId,
  locationTypes,
  onLocationTypeCreated,
  gameTypes,
  onGameTypeCreated,
  seasonsByLeague,
  onSeasonCreated,
  onClose,
  onSave,
  onLeagueCreated,
  onTeamCreated,
}: {
  open: boolean;
  sport: SportsCatalogEntry | null;
  initial: Omit<SportsRow, "sportId"> | null;
  initialLeagueId: number | null;
  locationTypes: EntertainmentLocationTypeItem[];
  onLocationTypeCreated: (item: EntertainmentLocationTypeItem) => void;
  gameTypes: SportsGameTypeItem[];
  onGameTypeCreated: (item: SportsGameTypeItem) => void;
  seasonsByLeague: Record<number, SportsSeasonItem[]>;
  onSeasonCreated: (leagueId: number, season: SportsSeasonItem) => void;
  onClose: () => void;
  onSave: (value: Omit<SportsRow, "sportId">) => void;
  onLeagueCreated: (sportId: number, league: SportsLeagueItem) => void;
  onTeamCreated: (sportId: number, team: SportsTeamItem) => void;
}) {
  const [leagueId, setLeagueId] = useState<number | null>(initial?.leagueId ?? initialLeagueId);
  const [homeTeamId, setHomeTeamId] = useState<number | null>(initial?.homeTeamId ?? null);
  const [awayTeamId, setAwayTeamId] = useState<number | null>(initial?.awayTeamId ?? null);
  const [season, setSeason] = useState(initial?.season ?? "");
  const [gameType, setGameType] = useState(initial?.gameType ?? "");
  const [watchedLive, setWatchedLive] = useState(initial?.watchedLive ?? false);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(initial?.durationMinutes ?? null);
  const [locationType, setLocationType] = useState(initial?.locationType ?? "");
  const [newLeagueOpen, setNewLeagueOpen] = useState(false);
  const [newTeamOpen, setNewTeamOpen] = useState(false);
  const [newSeasonOpen, setNewSeasonOpen] = useState(false);

  if (!sport) return null;

  const seasonOptions = leagueId !== null ? (seasonsByLeague[leagueId] ?? []) : [];
  const hasUnlistedSeason = season.trim() !== "" && !seasonOptions.some((s) => s.name === season);

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

          <TeamSelect
            id="sports-detail-home"
            label={sport.isTeamSport ? "Home team" : "Athlete"}
            value={homeTeamId}
            onChange={setHomeTeamId}
            teams={sport.teams}
            leagues={sport.leagues}
            selectedLeagueId={leagueId}
          />

          {sport.isTeamSport ? (
            <TeamSelect
              id="sports-detail-away"
              label="Away team"
              value={awayTeamId}
              onChange={setAwayTeamId}
              teams={sport.teams}
              leagues={sport.leagues}
              selectedLeagueId={leagueId}
            />
          ) : null}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="sports-detail-season">Season</Label>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setNewSeasonOpen(true)}
                disabled={leagueId === null}
              >
                + New
              </Button>
            </div>
            <Select id="sports-detail-season" value={season} onChange={(e) => setSeason(e.target.value)} disabled={leagueId === null}>
              <option value="">None</option>
              {hasUnlistedSeason ? <option value={season}>{season}</option> : null}
              {seasonOptions.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </Select>
            {leagueId === null ? <p className="text-xs text-muted-foreground">Pick a league to set a season.</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sports-detail-gametype">Game type</Label>
            <NameCatalogField
              id="sports-detail-gametype"
              value={gameType || null}
              onChange={(value) => setGameType(value ?? "")}
              items={gameTypes}
              onCreated={onGameTypeCreated}
              apiPath="/api/sports-game-types"
              modalTitle="New game type"
            />
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
            <Label htmlFor="sports-detail-duration">Watch time</Label>
            <DurationInput id="sports-detail-duration" totalMinutes={durationMinutes} onChange={setDurationMinutes} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sports-detail-location">Where</Label>
            <NameCatalogField
              id="sports-detail-location"
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
      <NewSeasonModal
        open={newSeasonOpen}
        leagueId={leagueId}
        onClose={() => setNewSeasonOpen(false)}
        onCreated={(created) => {
          if (leagueId !== null) onSeasonCreated(leagueId, created);
          setSeason(created.name);
        }}
      />
    </>
  );
}

export function SportsSection({
  catalog,
  locationTypes,
  onLocationTypeCreated,
  gameTypes: initialGameTypes,
  seasonsByLeague: initialSeasonsByLeague,
  rows,
  onRowsChange,
  pendingOpen,
}: {
  catalog: SportsCatalogEntry[];
  locationTypes: EntertainmentLocationTypeItem[];
  onLocationTypeCreated: (item: EntertainmentLocationTypeItem) => void;
  gameTypes: SportsGameTypeItem[];
  seasonsByLeague: Record<number, SportsSeasonItem[]>;
  rows: SportsRow[];
  onRowsChange: (rows: SportsRow[]) => void;
  pendingOpen: PendingOpen;
}) {
  const [items, setItems] = useState<SportsCatalogEntry[]>(catalog);
  const [gameTypes, setGameTypes] = useState(initialGameTypes);
  const [seasonsByLeague, setSeasonsByLeague] = useState(initialSeasonsByLeague);
  const [newSportOpen, setNewSportOpen] = useState(false);
  const [detail, setDetail] = useState<{ sport: SportsCatalogEntry; leagueId: number | null; editIndex: number | null } | null>(
    null
  );

  const editingRow = detail?.editIndex !== null && detail?.editIndex !== undefined ? rows[detail.editIndex] : null;

  // The unified search encodes a LEAGUE id (issue #61) — find the sport
  // that owns it.
  const pendingLeagueId = usePendingOpenMatch(pendingOpen, "sports");
  if (pendingLeagueId !== null) {
    const sport = items.find((s) => s.leagues.some((l) => l.id === pendingLeagueId));
    if (sport) setDetail({ sport, leagueId: pendingLeagueId, editIndex: null });
  }

  function updateCatalogSport(sportId: number, updater: (s: SportsCatalogEntry) => SportsCatalogEntry) {
    setItems((prev) => prev.map((s) => (s.id === sportId ? updater(s) : s)));
    setDetail((prev) => (prev && prev.sport.id === sportId ? { ...prev, sport: updater(prev.sport) } : prev));
  }

  function handleSportCreated(item: SportCatalogItem) {
    const entry: SportsCatalogEntry = { ...item, leagues: [], teams: [] };
    setItems((prev) => [...prev, entry].sort((a, b) => a.name.localeCompare(b.name)));
    setNewSportOpen(false);
    setDetail({ sport: entry, leagueId: null, editIndex: null });
  }

  function handleLeagueCreated(sportId: number, league: SportsLeagueItem) {
    updateCatalogSport(sportId, (s) => ({ ...s, leagues: [...s.leagues, league] }));
  }

  function handleTeamCreated(sportId: number, team: SportsTeamItem) {
    updateCatalogSport(sportId, (s) => ({ ...s, teams: [...s.teams, team] }));
  }

  function handleSeasonCreated(leagueId: number, season: SportsSeasonItem) {
    setSeasonsByLeague((prev) => ({
      ...prev,
      [leagueId]: [...(prev[leagueId] ?? []), season].sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }

  function openForEdit(index: number) {
    const row = rows[index];
    const sport = items.find((s) => s.id === row.sportId);
    if (!sport) return;
    setDetail({ sport, leagueId: row.leagueId, editIndex: index });
  }

  function saveDetail(value: Omit<SportsRow, "sportId">) {
    if (!detail) return;
    if (detail.editIndex !== null) {
      const next = [...rows];
      next[detail.editIndex] = { sportId: detail.sport.id, ...value };
      onRowsChange(next);
    } else {
      onRowsChange([...rows, { sportId: detail.sport.id, ...value }]);
    }
    setDetail(null);
  }

  function removeRow(index: number) {
    onRowsChange(rows.filter((_, i) => i !== index));
  }

  function describeRow(row: SportsRow): string {
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

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Sports</CardTitle>
          <Button type="button" variant="outline" size="xs" onClick={() => setNewSportOpen(true)}>
            + New sport
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">None logged yet.</p> : null}
        {rows.map((row, i) => (
          <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
            <button type="button" onClick={() => openForEdit(i)} className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm">{describeRow(row)}</p>
            </button>
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove" onClick={() => removeRow(i)}>
              &times;
            </Button>
          </div>
        ))}
      </CardContent>

      <NewSportModal open={newSportOpen} onClose={() => setNewSportOpen(false)} onCreated={handleSportCreated} />

      <SportsWatchDetailModal
        key={detail ? `${detail.sport.id}-${detail.editIndex ?? "new"}` : "closed"}
        open={detail !== null}
        sport={detail?.sport ?? null}
        initial={editingRow ?? null}
        initialLeagueId={detail?.leagueId ?? null}
        locationTypes={locationTypes}
        onLocationTypeCreated={onLocationTypeCreated}
        gameTypes={gameTypes}
        onGameTypeCreated={(item) => setGameTypes((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))}
        seasonsByLeague={seasonsByLeague}
        onSeasonCreated={handleSeasonCreated}
        onClose={() => setDetail(null)}
        onSave={saveDetail}
        onLeagueCreated={handleLeagueCreated}
        onTeamCreated={handleTeamCreated}
      />
    </Card>
  );
}
