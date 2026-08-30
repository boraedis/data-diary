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
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import type { SportCatalogItem, SportsLeagueItem, SportsTeamItem, SportUsage } from "@/lib/days";

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

// #9: leagues/teams used to be compact inline rows (LeagueRow/TeamRow) that
// crammed a truncated name, a watch-count expand toggle, Edit, and Delete
// into one line, then squeezed a height-capped watch-history list into the
// same card when expanded. Now they're CatalogBrowser lists — the same
// search-and-open pattern every other catalog in this app uses — and
// clicking through takes you to a real detail page (sports-league-detail.tsx
// / sports-team-detail.tsx) with room for the full edit form and an
// uncapped watch-history card. Delete now lives on that detail page too,
// matching where every other catalog puts it (e.g. MovieDetail), rather
// than being a second action crammed into the list row.
export function SportDetail({
  sport: initial,
  usage,
  leagues: initialLeagues,
  teams: initialTeams,
}: {
  sport: SportCatalogItem;
  usage: SportUsage;
  leagues: SportsLeagueItem[];
  teams: SportsTeamItem[];
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
            <CardTitle>Leagues</CardTitle>
          </CardHeader>
          <CardContent>
            <CatalogBrowser
              items={leagues.map((l) => ({ id: l.id, primary: l.name, secondary: l.type }))}
              basePath="/manage/entertainment/sports/leagues"
              placeholder="Search leagues…"
              emptyMessage="No leagues yet."
              trailingAction={
                <Button type="button" variant="outline" className="shrink-0" onClick={() => setAddLeagueOpen(true)}>
                  + New league
                </Button>
              }
            />
          </CardContent>
        </Card>

        <Card size="sm" className="md:h-full">
          <CardHeader>
            <CardTitle>Teams</CardTitle>
          </CardHeader>
          <CardContent>
            <CatalogBrowser
              items={teams.map((t) => ({
                id: t.id,
                primary: t.name,
                secondary: [leagues.find((l) => l.id === t.leagueId)?.name, t.homeLocation].filter(Boolean).join(" · ") || null,
              }))}
              basePath="/manage/entertainment/sports/teams"
              placeholder="Search teams…"
              emptyMessage="No teams yet."
              trailingAction={
                <Button type="button" variant="outline" className="shrink-0" onClick={() => setAddTeamOpen(true)}>
                  + New team
                </Button>
              }
            />
          </CardContent>
        </Card>
      </div>

      <AddLeagueModal
        sportId={sport.id}
        open={addLeagueOpen}
        onClose={() => setAddLeagueOpen(false)}
        onCreated={(league) => setLeagues((prev) => [...prev, league])}
      />
      <AddTeamModal
        sportId={sport.id}
        leagues={leagues}
        open={addTeamOpen}
        onClose={() => setAddTeamOpen(false)}
        onCreated={(team) => setTeams((prev) => [...prev, team])}
      />
    </>
  );
}
