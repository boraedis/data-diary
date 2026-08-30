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
import type { EntertainmentCatalogItem, EntertainmentUsage } from "@/lib/days";
import type { EntertainmentKindItem } from "@/lib/catalog-admin";

// Unlike the two "+ New entertainment" modals, editing an EXISTING catalog
// item offers every kind, system ones included — this is managing
// something that's already here (often a historical row predating the
// dedicated movie/tvshow/sport/book tables, see the entertainmentKinds
// table comment in schema.ts), not creating a new bypass of those tables.
export function EntertainmentDetail({
  item: initial,
  usage,
  kinds,
}: {
  item: EntertainmentCatalogItem;
  usage: EntertainmentUsage;
  kinds: EntertainmentKindItem[];
}) {
  const router = useRouter();
  const [item, setItem] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [kindId, setKindId] = useState(initial.kindId);
  const [title, setTitle] = useState(initial.title);
  const [detail, setDetail] = useState(initial.detail ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancelEdit() {
    setKindId(item.kindId);
    setTitle(item.title);
    setDetail(item.detail ?? "");
    setError(null);
    setEditing(false);
  }

  async function handleSave() {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/entertainment-catalog/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kindId, title: title.trim(), detail: detail.trim() || null }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      setItem(body as EntertainmentCatalogItem);
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
        <Link href="/manage/entertainment" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; Entertainment
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{editing ? "Edit entertainment" : item.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="entertainment-kind">Kind</Label>
                <Select
                  id="entertainment-kind"
                  value={kindId}
                  onChange={(e) => setKindId(Number(e.target.value))}
                >
                  {kinds.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="entertainment-title">Title</Label>
                <Input id="entertainment-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="entertainment-detail">Detail</Label>
                <Input id="entertainment-detail" value={detail} onChange={(e) => setDetail(e.target.value)} />
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
                <dt className="text-muted-foreground">Kind</dt>
                <dd>{item.kindName}</dd>
                <dt className="text-muted-foreground">Detail</dt>
                <dd>{item.detail ?? "—"}</dd>
              </dl>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <DeleteCatalogItem
                  itemLabel={item.title}
                  isBlocked={usage.dates.length > 0}
                  afterDeleteHref="/manage/entertainment"
                  onDelete={async () => {
                    const res = await fetch(`/api/entertainment-catalog/${item.id}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Failed to delete");
                  }}
                  blockedContent={
                    <ul className="list-inside list-disc">
                      {usage.dates.map((date) => (
                        <li key={date}>
                          <Link href={`/day/${date}/entertainment`} className="text-primary hover:underline">
                            {date}
                          </Link>
                        </li>
                      ))}
                    </ul>
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
