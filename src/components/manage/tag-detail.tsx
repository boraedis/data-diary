"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import type { RecommendedTagMember, TagCatalogItem, TagUsage } from "@/lib/catalog-admin";

export function TagDetail({
  tag: initial,
  usage,
  recommended,
}: {
  tag: TagCatalogItem;
  usage: TagUsage;
  recommended: RecommendedTagMember[];
}) {
  const router = useRouter();
  const [tag, setTag] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color ?? "#64748b");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancelEdit() {
    setName(tag.name);
    setColor(tag.color ?? "#64748b");
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
      const res = await fetch(`/api/tags/${tag.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), color }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      setTag(body as TagCatalogItem);
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
        <Link href="/manage/people/tags" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; Tags
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{editing ? "Edit tag" : tag.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="tag-name">Name</Label>
                <Input id="tag-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tag-color">Color</Label>
                <input
                  id="tag-color"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-8 w-16 cursor-pointer rounded border border-input bg-transparent"
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
                <dt className="text-muted-foreground">Color</dt>
                <dd className="flex items-center gap-2">
                  <span
                    className="inline-block size-3 rounded-full border border-border"
                    style={{ backgroundColor: tag.color ?? undefined }}
                  />
                  {tag.color ?? "—"}
                </dd>
                <dt className="text-muted-foreground">People</dt>
                <dd>{usage.members.length}</dd>
              </dl>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <DeleteCatalogItem
                  itemLabel={tag.name}
                  isBlocked={usage.members.length > 0}
                  afterDeleteHref="/manage/people/tags"
                  onDelete={async () => {
                    const res = await fetch(`/api/tags/${tag.id}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Failed to delete");
                  }}
                  blockedContent={
                    <ul className="list-inside list-disc">
                      {usage.members.map((person) => (
                        <li key={person.id}>
                          <Link href={`/manage/people/${person.id}`} className="text-primary hover:underline">
                            {person.name}
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

      <Card size="sm">
        <CardHeader>
          <CardTitle>Members ({usage.members.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {usage.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody is tagged {tag.name} yet.</p>
          ) : (
            usage.members.map((person) => (
              <Link
                key={person.id}
                href={`/manage/people/${person.id}`}
                className="rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                {person.name}
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      {recommended.length > 0 ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Recommended members</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              People who frequently show up on the same day as {tag.name}, but aren&apos;t tagged that way — maybe
              they belong here too.
            </p>
            {recommended.map((person) => (
              <Link
                key={person.id}
                href={`/manage/people/${person.id}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                <span>{person.name}</span>
                <span className="flex items-center gap-2 shrink-0">
                  {person.tagName ? (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      <span
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: person.tagColor ?? undefined }}
                      />
                      {person.tagName}
                    </span>
                  ) : null}
                  <span className="font-mono text-xs text-muted-foreground">{person.score}</span>
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
