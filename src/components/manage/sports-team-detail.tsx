"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import { SportsWatchHistoryList } from "@/components/manage/sports-watch-history-list";
import type { SportCatalogItem, SportsLeagueItem, SportsTeamItem, SportsTeamUsage } from "@/lib/days";

// Full detail page for a single team — see #9. Same shape as
// SportsLeagueDetail; the extra fields (league, alias, home location,
// color, division) mirror what AddTeamModal/TeamRow already collected.
export function SportsTeamDetail({
  sport,
  team: initial,
  leagues,
  usage,
}: {
  sport: SportCatalogItem;
  team: SportsTeamItem;
  leagues: SportsLeagueItem[];
  usage: SportsTeamUsage;
}) {
  const router = useRouter();
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

  const leagueName = leagues.find((l) => l.id === team.leagueId)?.name ?? null;

  function cancelEdit() {
    setName(team.name);
    setLeagueId(team.leagueId);
    setAlias(team.alias ?? "");
    setHomeLocation(team.homeLocation ?? "");
    setColor(team.color ?? "");
    setDivision(team.division ?? "");
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
      setTeam(body as SportsTeamItem);
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
        <Link
          href={`/manage/entertainment/sports/${sport.id}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          &larr; {sport.name}
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{editing ? "Edit team" : team.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="team-name">Name</Label>
                <Input id="team-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </div>
              {leagues.length > 0 ? (
                <div className="space-y-1.5">
                  <Label htmlFor="team-league">League</Label>
                  <Select
                    id="team-league"
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
                <Label htmlFor="team-alias">Alias</Label>
                <Input id="team-alias" value={alias} onChange={(e) => setAlias(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="team-location">Home location</Label>
                <Input id="team-location" value={homeLocation} onChange={(e) => setHomeLocation(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="team-color">Color</Label>
                <Input
                  id="team-color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="#xxxxxx"
                  pattern="^#[0-9a-fA-F]{6}$"
                  title="Use format #xxxxxx"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="team-division">Division</Label>
                <Input id="team-division" value={division} onChange={(e) => setDivision(e.target.value)} />
              </div>
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
                <dt className="text-muted-foreground">League</dt>
                <dd>{leagueName ?? "—"}</dd>
                <dt className="text-muted-foreground">Alias</dt>
                <dd>{team.alias ?? "—"}</dd>
                <dt className="text-muted-foreground">Home location</dt>
                <dd>{team.homeLocation ?? "—"}</dd>
                <dt className="text-muted-foreground">Color</dt>
                <dd>{team.color ?? "—"}</dd>
                <dt className="text-muted-foreground">Division</dt>
                <dd>{team.division ?? "—"}</dd>
                <dt className="text-muted-foreground">Logged watches</dt>
                <dd>{usage.watchCount}</dd>
              </dl>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <DeleteCatalogItem
                  itemLabel={team.name}
                  isBlocked={false}
                  afterDeleteHref={`/manage/entertainment/sports/${sport.id}`}
                  onDelete={async () => {
                    const res = await fetch(`/api/sports-teams/${team.id}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Failed to delete");
                  }}
                  blockedContent={null}
                  warningContent={
                    usage.watchCount > 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {usage.watchCount} logged watch{usage.watchCount === 1 ? "" : "es"} will lose this team
                        (kept, just unassigned).
                      </p>
                    ) : undefined
                  }
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Watch history</CardTitle>
        </CardHeader>
        <CardContent className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          <SportsWatchHistoryList watches={usage.watches} perspectiveTeamName={team.name} />
        </CardContent>
      </Card>
    </>
  );
}
