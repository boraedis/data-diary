"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import { SportsWatchHistoryList } from "@/components/manage/sports-watch-history-list";
import type { SportCatalogItem, SportsLeagueItem, SportsLeagueUsage } from "@/lib/days";
import type { SportsSeasonItem, SportsSeasonUsage } from "@/lib/catalog-admin";

type SeasonWithUsage = SportsSeasonItem & { usage: SportsSeasonUsage };

function AddSeasonModal({
  leagueId,
  open,
  onClose,
  onCreated,
}: {
  leagueId: number;
  open: boolean;
  onClose: () => void;
  onCreated: (season: SportsSeasonItem) => void;
}) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setError(null);
  }

  async function handleCreate() {
    if (!name.trim()) return;
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
          <Label htmlFor="add-sports-season-name">Name</Label>
          <Input
            id="add-sports-season-name"
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

function SeasonRow({
  season: initial,
  onUpdated,
  onDeleted,
}: {
  season: SeasonWithUsage;
  onUpdated: (season: SportsSeasonItem) => void;
  onDeleted: (id: number) => void;
}) {
  const [season, setSeason] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/sports-seasons/${season.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      const updated = { ...season, ...(body as SportsSeasonItem) };
      setSeason(updated);
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
              setName(season.name);
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
      <p className="min-w-0 truncate text-sm">{season.name}</p>
      <div className="flex shrink-0 gap-1">
        <Button type="button" size="xs" variant="outline" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <DeleteCatalogItem
          size="xs"
          itemLabel={season.name}
          isBlocked={season.usage.watchCount > 0}
          onDelete={async () => {
            const res = await fetch(`/api/sports-seasons/${season.id}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Failed to delete");
            onDeleted(season.id);
          }}
          blockedContent={
            <p>
              {season.usage.watchCount} watch{season.usage.watchCount === 1 ? "" : "es"} still{" "}
              {season.usage.watchCount === 1 ? "uses" : "use"} this season.
            </p>
          }
        />
      </div>
    </div>
  );
}

// Full detail page for a single league — see #9. Previously this was an
// inline expand/edit row crammed into the parent sport's Leagues card
// (LeagueRow in sport-detail.tsx), competing for space with the name label
// and a height-capped watch-history toggle. Same edit/delete/watch-history
// shape, just given a real page.
export function SportsLeagueDetail({
  sport,
  league: initial,
  usage,
  seasons: initialSeasons,
}: {
  sport: SportCatalogItem;
  league: SportsLeagueItem;
  usage: SportsLeagueUsage;
  seasons: SeasonWithUsage[];
}) {
  const router = useRouter();
  const [league, setLeague] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [type, setType] = useState(initial.type ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seasons, setSeasons] = useState(initialSeasons);
  const [addSeasonOpen, setAddSeasonOpen] = useState(false);

  function cancelEdit() {
    setName(league.name);
    setType(league.type ?? "");
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
      setLeague(body as SportsLeagueItem);
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
          <CardTitle>{editing ? "Edit league" : league.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="league-name">Name</Label>
                <Input id="league-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="league-type">Type</Label>
                <Input
                  id="league-type"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  placeholder="college, pro…"
                />
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
                <dt className="text-muted-foreground">Type</dt>
                <dd>{league.type ?? "—"}</dd>
                <dt className="text-muted-foreground">Teams</dt>
                <dd>{usage.teamCount}</dd>
                <dt className="text-muted-foreground">Logged watches</dt>
                <dd>{usage.watchCount}</dd>
              </dl>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <DeleteCatalogItem
                  itemLabel={league.name}
                  isBlocked={false}
                  afterDeleteHref={`/manage/entertainment/sports/${sport.id}`}
                  onDelete={async () => {
                    const res = await fetch(`/api/sports-leagues/${league.id}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Failed to delete");
                  }}
                  blockedContent={null}
                  warningContent={
                    usage.teamCount > 0 || usage.watchCount > 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {usage.teamCount} team{usage.teamCount === 1 ? "" : "s"} and {usage.watchCount} logged watch
                        {usage.watchCount === 1 ? "" : "es"} will lose this league (kept, just unassigned).
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
          <div className="flex items-center justify-between">
            <CardTitle>Seasons</CardTitle>
            <Button type="button" variant="outline" size="xs" onClick={() => setAddSeasonOpen(true)}>
              + New season
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {seasons.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : null}
          {seasons.map((s) => (
            <SeasonRow
              key={s.id}
              season={s}
              onUpdated={(updated) =>
                setSeasons((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)))
              }
              onDeleted={(id) => setSeasons((prev) => prev.filter((x) => x.id !== id))}
            />
          ))}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Watch history</CardTitle>
        </CardHeader>
        <CardContent className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          <SportsWatchHistoryList watches={usage.watches} />
        </CardContent>
      </Card>

      <AddSeasonModal
        leagueId={league.id}
        open={addSeasonOpen}
        onClose={() => setAddSeasonOpen(false)}
        onCreated={(season) => setSeasons((prev) => [...prev, { ...season, usage: { watchCount: 0 } }])}
      />
    </>
  );
}
