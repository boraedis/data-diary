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
import type { GameDeviceTypeItem, GameDeviceTypeUsage } from "@/lib/catalog-admin";

export function GameDeviceTypeDetail({
  deviceType: initial,
  usage,
}: {
  deviceType: GameDeviceTypeItem;
  usage: GameDeviceTypeUsage;
}) {
  const router = useRouter();
  const [deviceType, setDeviceType] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancelEdit() {
    setName(deviceType.name);
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
      const res = await fetch(`/api/game-device-types/${deviceType.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      setDeviceType(body as GameDeviceTypeItem);
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
          href="/manage/entertainment/games/device-types"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          &larr; Device types
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{editing ? "Edit device type" : deviceType.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="game-device-type-name">Name</Label>
                <Input id="game-device-type-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">
                Renaming doesn&rsquo;t update sessions that already carry the old name — see the session&rsquo;s own
                Device type field to change that.
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
                <dt className="text-muted-foreground">Logged sessions</dt>
                <dd>{usage.sessionCount}</dd>
              </dl>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <DeleteCatalogItem
                  itemLabel={deviceType.name}
                  isBlocked={usage.sessionCount > 0}
                  afterDeleteHref="/manage/entertainment/games/device-types"
                  onDelete={async () => {
                    const res = await fetch(`/api/game-device-types/${deviceType.id}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Failed to delete");
                  }}
                  blockedContent={
                    <p>
                      {usage.sessionCount} session{usage.sessionCount === 1 ? "" : "s"} still use this device type.
                    </p>
                  }
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Session history</CardTitle>
        </CardHeader>
        <CardContent className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          <CatalogUsageHistory
            history={usage.sessions.map((s) => ({ date: s.date, label: s.gameName }))}
            daySegment="entertainment"
            emptyText="No sessions logged."
          />
        </CardContent>
      </Card>
    </>
  );
}
