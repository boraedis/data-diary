"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import type {
  SportCatalogItem,
  SportsLeagueItem,
  SportsLeagueUsage,
  SportsTeamItem,
  SportsTeamUsage,
  SportUsage,
} from "@/lib/days";

type LeagueWithUsage = SportsLeagueItem & { usage: SportsLeagueUsage };
type TeamWithUsage = SportsTeamItem & { usage: SportsTeamUsage };

function AddLeagueModal({
  sportId,
  open,
  onClose,
  onCreated,
}: {
  sportId: number;
  open: boolean;
  onClose: () => void;
  onCreated: (league: SportsLeagueItem) => void;
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
    if (!name.trim()) return;
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
          <Label htmlFor="add-league-name">Name</Label>
          <Input id="add-league-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="add-league-type">Type</Label>
          <Input id="add-league-type" value={type} onChange={(e) => setType(e.target.value)} placeholder="college, pro…" />
        </div>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        <Button type="button" onClick={handleCreate} disabled={creating || !name.trim()}>
          {creating ? "Adding…" : "Add"}
        </Button>
      </div>
    </Modal>
  );
}

function AddTeamModal({
  sportId,
  leagues,
  open,
  onClose,
  onCreated,
}: {
  sportId: number;
  leagues: SportsLeagueItem[];
  open: boolean;
  onClose: () => void;
  onCreated: (team: SportsTeamItem) => void;
}) {
  const [name, setName] = useState("");
  const [leagueId, setLeagueId] = useState<number | null>(null);
  const [alias, setAlias] = useState("");
  const [homeLocation, setHomeLocation] = useState("");
  const [color, setColor] = useState("");
  const [division, setDivision] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setLeagueId(null);
    setAlias("");
    setHomeLocation("");
    setColor("");
    setDivision("");
    setError(null);
  }

  async function handleCreate() {
    if (!name.trim()) return;
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
          color: color.trim() || null,
          division: division.trim() || null,
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
          <Label htmlFor="add-team-name">Name</Label>
          <Input id="add-team-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        {leagues.length > 0 ? (
          <div className="space-y-1.5">
            <Label htmlFor="add-team-league">League</Label>
            <Select
              id="add-team-league"
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
          <Label htmlFor="add-team-alias">Alias</Label>
          <Input id="add-team-alias" value={alias} onChange={(e) => setAlias(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="add-team-location">Home location</Label>
          <Input id="add-team-location" value={homeLocation} onChange={(e) => setHomeLocation(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="add-team-color">Color</Label>
          <Input id="add-team-color" value={color} onChange={(e) => setColor(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="add-team-division">Division</Label>
          <Input id="add-team-division" value={division} onChange={(e) => setDivision(e.target.value)} />
        </div>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        <Button type="button" onClick={handleCreate} disabled={creating || !name.trim()}>
          {creating ? "Adding…" : "Add"}
        </Button>
      </div>
    </Modal>
  );
}

function LeagueRow({
  league: initial,
  onUpdated,
  onDeleted,
}: {
  league: LeagueWithUsage;
  onUpdated: (league: SportsLeagueItem) => void;
  onDeleted: (id: number) => void;
}) {
  const [league, setLeague] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [type, setType] = useState(initial.type ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/sports-leagues/${league.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type: type.trim() || null }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      const updated = { ...league, ...(body as SportsLeagueItem) };
      setLeague(updated);
      onUpdated(updated);
      setEditing(false);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoFocus />
        <Input value={type} onChange={(e) => setType(e.target.value)} placeholder="Type (college, pro…)" />
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
        <div className="flex gap-2">
          <Button type="button" size="xs" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => {
              setName(league.name);
              setType(league.type ?? "");
              setError(null);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm">{league.name}</p>
        {league.type ? <p className="truncate text-xs text-muted-foreground">{league.type}</p> : null}
      </div>
      <div className="flex shrink-0 gap-1">
        <Button type="button" size="xs" variant="outline" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <DeleteCatalogItem
          itemLabel={league.name}
          isBlocked={false}
          onDelete={async () => {
            const res = await fetch(`/api/sports-leagues/${league.id}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Failed to delete");
            onDeleted(league.id);
          }}
          blockedContent={null}
          warningContent={
            league.usage.teamCount > 0 || league.usage.watchCount > 0 ? (
              <p className="text-sm text-muted-foreground">
                {league.usage.teamCount} team{league.usage.teamCount === 1 ? "" : "s"} and {league.usage.watchCount}{" "}
                logged watch{league.usage.watchCount === 1 ? "" : "es"} will lose this league (kept, just
                unassigned).
              </p>
            ) : undefined
          }
        />
      </div>
    </div>
  );
}

function TeamRow({
  team: initial,
  leagues,
  onUpdated,
  onDeleted,
}: {
  team: TeamWithUsage;
  leagues: SportsLeagueItem[];
  onUpdated: (team: SportsTeamItem) => void;
  onDeleted: (id: number) => void;
}) {
  const [team, setTeam] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [leagueId, setLeagueId] = useState<number | null>(initial.leagueId);
  const [alias, setAlias] = useState(initial.alias ?? "");
  const [homeLocation, setHomeLocation] = useState(initial.homeLocation ?? "");
  const [color, setColor] = useState(initial.color ?? "");
  const [division, setDivision] = useState(initial.division ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/sports-teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          leagueId,
          alias: alias.trim() || null,
          homeLocation: homeLocation.trim() || null,
          color: color.trim() || null,
          division: division.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      const updated = { ...team, ...(body as SportsTeamItem) };
      setTeam(updated);
      onUpdated(updated);
      setEditing(false);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  const leagueName = leagues.find((l) => l.id === team.leagueId)?.name ?? null;

  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoFocus />
        {leagues.length > 0 ? (
          <Select value={leagueId ?? ""} onChange={(e) => setLeagueId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">No league</option>
            {leagues.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Alias" />
        <Input value={homeLocation} onChange={(e) => setHomeLocation(e.target.value)} placeholder="Home location" />
        <Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Color" />
        <Input value={division} onChange={(e) => setDivision(e.target.value)} placeholder="Division" />
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
        <div className="flex gap-2">
          <Button type="button" size="xs" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => {
              setName(team.name);
              setLeagueId(team.leagueId);
              setAlias(team.alias ?? "");
              setHomeLocation(team.homeLocation ?? "");
              setColor(team.color ?? "");
              setDivision(team.division ?? "");
              setError(null);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm">{team.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[leagueName, team.homeLocation].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button type="button" size="xs" variant="outline" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <DeleteCatalogItem
          itemLabel={team.name}
          isBlocked={false}
          onDelete={async () => {
            const res = await fetch(`/api/sports-teams/${team.id}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Failed to delete");
            onDeleted(team.id);
          }}
          blockedContent={null}
          warningContent={
            team.usage.watchCount > 0 ? (
              <p className="text-sm text-muted-foreground">
                {team.usage.watchCount} logged watch{team.usage.watchCount === 1 ? "" : "es"} will lose this team
                (kept, just unassigned).
              </p>
            ) : undefined
          }
        />
      </div>
    </div>
  );
}

export function SportDetail({
  sport: initial,
  usage,
  leagues: initialLeagues,
  teams: initialTeams,
}: {
  sport: SportCatalogItem;
  usage: SportUsage;
  leagues: LeagueWithUsage[];
  teams: TeamWithUsage[];
}) {
  const router = useRouter();
  const [sport, setSport] = useState(initial);
  const [leagues, setLeagues] = useState(initialLeagues);
  const [teams, setTeams] = useState(initialTeams);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [isTeamSport, setIsTeamSport] = useState(initial.isTeamSport);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addLeagueOpen, setAddLeagueOpen] = useState(false);
  const [addTeamOpen, setAddTeamOpen] = useState(false);

  function cancelEdit() {
    setName(sport.name);
    setIsTeamSport(sport.isTeamSport);
    setError(null);
    setEditing(false);
  }

  async function handleSave() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/sports/${sport.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), isTeamSport }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      setSport(body as SportCatalogItem);
      setEditing(false);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <Link href="/manage/entertainment/sports" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; Sports
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{editing ? "Edit sport" : sport.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="sport-name">Name</Label>
                <Input id="sport-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input accent-primary"
                  checked={isTeamSport}
                  onChange={(e) => setIsTeamSport(e.target.checked)}
                />
                Team sport
              </label>
              {error ? <span className="text-sm text-destructive">{error}</span> : null}
              <div className="flex gap-2">
                <Button type="button" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button type="button" variant="outline" onClick={cancelEdit} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Type</dt>
                <dd>{sport.isTeamSport ? "Team sport" : "Individual"}</dd>
                <dt className="text-muted-foreground">Logged watches</dt>
                <dd>{usage.watchCount}</dd>
              </dl>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <DeleteCatalogItem
                  itemLabel={sport.name}
                  isBlocked={usage.watchCount > 0}
                  afterDeleteHref="/manage/entertainment/sports"
                  onDelete={async () => {
                    const res = await fetch(`/api/sports/${sport.id}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Failed to delete");
                  }}
                  blockedContent={<p>This sport has {usage.watchCount} logged watch(es) and can&rsquo;t be deleted.</p>}
                  warningContent={
                    usage.leagueCount > 0 || usage.teamCount > 0 ? (
                      <p className="text-sm text-muted-foreground">
                        This will also delete {usage.leagueCount} league{usage.leagueCount === 1 ? "" : "s"} and{" "}
                        {usage.teamCount} team{usage.teamCount === 1 ? "" : "s"} under it.
                      </p>
                    ) : undefined
                  }
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4 md:grid md:grid-cols-2 md:gap-5">
        <Card size="sm" className="md:h-full">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Leagues</CardTitle>
              <Button type="button" variant="outline" size="xs" onClick={() => setAddLeagueOpen(true)}>
                + New league
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {leagues.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : null}
            {leagues.map((l) => (
              <LeagueRow
                key={l.id}
                league={l}
                onUpdated={(updated) => setLeagues((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)))}
                onDeleted={(id) => setLeagues((prev) => prev.filter((x) => x.id !== id))}
              />
            ))}
          </CardContent>
        </Card>

        <Card size="sm" className="md:h-full">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Teams</CardTitle>
              <Button type="button" variant="outline" size="xs" onClick={() => setAddTeamOpen(true)}>
                + New team
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {teams.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : null}
            {teams.map((t) => (
              <TeamRow
                key={t.id}
                team={t}
                leagues={leagues}
                onUpdated={(updated) => setTeams((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)))}
                onDeleted={(id) => setTeams((prev) => prev.filter((x) => x.id !== id))}
              />
            ))}
          </CardContent>
        </Card>
      </div>

      <AddLeagueModal
        sportId={sport.id}
        open={addLeagueOpen}
        onClose={() => setAddLeagueOpen(false)}
        onCreated={(league) => setLeagues((prev) => [...prev, { ...league, usage: { teamCount: 0, watchCount: 0 } }])}
      />
      <AddTeamModal
        sportId={sport.id}
        leagues={leagues}
        open={addTeamOpen}
        onClose={() => setAddTeamOpen(false)}
        onCreated={(team) => setTeams((prev) => [...prev, { ...team, usage: { watchCount: 0 } }])}
      />
    </>
  );
}
