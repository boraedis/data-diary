"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import { CatalogUsageHistory } from "@/components/manage/catalog-usage-history";
import type { EntertainmentLocationTypeItem, EntertainmentLocationTypeUsage } from "@/lib/catalog-admin";

export function EntertainmentLocationTypeDetail({
  type: initial,
  usage,
}: {
  type: EntertainmentLocationTypeItem;
  usage: EntertainmentLocationTypeUsage;
}) {
  const router = useRouter();
  const [type, setType] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = usage.movieCount + usage.tvEpisodeCount + usage.bookCount + usage.sportsCount + usage.gameCount;

  function cancelEdit() {
    setName(type.name);
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
      const res = await fetch(`/api/entertainment-location-types/${type.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      setType(body as EntertainmentLocationTypeItem);
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
        <Link href="/manage/entertainment/location-types" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; Location types
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{editing ? "Edit location type" : type.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="entertainment-location-type-name">Name</Label>
                <Input id="entertainment-location-type-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">
                Renaming doesn&rsquo;t update watches/sessions that already carry the old name — see the entry&rsquo;s
                own Where field to change that.
              </p>
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
                <dt className="text-muted-foreground">Movie watches</dt>
                <dd>{usage.movieCount}</dd>
                <dt className="text-muted-foreground">TV episode watches</dt>
                <dd>{usage.tvEpisodeCount}</dd>
                <dt className="text-muted-foreground">Book sessions</dt>
                <dd>{usage.bookCount}</dd>
                <dt className="text-muted-foreground">Sports watches</dt>
                <dd>{usage.sportsCount}</dd>
                <dt className="text-muted-foreground">Game sessions</dt>
                <dd>{usage.gameCount}</dd>
              </dl>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <DeleteCatalogItem
                  itemLabel={type.name}
                  isBlocked={total > 0}
                  afterDeleteHref="/manage/entertainment/location-types"
                  onDelete={async () => {
                    const res = await fetch(`/api/entertainment-location-types/${type.id}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Failed to delete");
                  }}
                  blockedContent={<p>{total} entertainment entr{total === 1 ? "y" : "ies"} still use this location type.</p>}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          <CatalogUsageHistory
            history={usage.history.map((h) => ({ date: h.date, label: h.label, secondary: h.kind }))}
            daySegment="entertainment"
          />
        </CardContent>
      </Card>
    </>
  );
}
