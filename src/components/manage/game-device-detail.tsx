"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import type { GameDeviceItem, GameDeviceUsage } from "@/lib/catalog-admin";

export function GameDeviceDetail({ device: initial, usage }: { device: GameDeviceItem; usage: GameDeviceUsage }) {
  const router = useRouter();
  const [device, setDevice] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancelEdit() {
    setName(device.name);
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
      const res = await fetch(`/api/game-devices/${device.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      setDevice(body as GameDeviceItem);
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
        <Link href="/manage/entertainment/games/devices" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; Devices
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{editing ? "Edit device" : device.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="game-device-name">Name</Label>
                <Input id="game-device-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">
                Renaming doesn&rsquo;t update sessions that already carry the old name — see the session&rsquo;s own
                Device field to change that.
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
                  itemLabel={device.name}
                  isBlocked={usage.sessionCount > 0}
                  afterDeleteHref="/manage/entertainment/games/devices"
                  onDelete={async () => {
                    const res = await fetch(`/api/game-devices/${device.id}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Failed to delete");
                  }}
                  blockedContent={
                    <p>{usage.sessionCount} session{usage.sessionCount === 1 ? "" : "s"} still use this device.</p>
                  }
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
