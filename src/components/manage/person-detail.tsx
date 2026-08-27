"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import { TagPicker } from "@/components/tag-picker";
import type { PersonCatalogItem, PersonUsage } from "@/lib/days";
import type { TagCatalogItem } from "@/lib/catalog-admin";

export function PersonDetail({
  person: initial,
  usage,
  initialTags,
}: {
  person: PersonCatalogItem;
  usage: PersonUsage;
  initialTags: TagCatalogItem[];
}) {
  const router = useRouter();
  const [person, setPerson] = useState(initial);
  const [tags, setTags] = useState(initialTags);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [nicknames, setNicknames] = useState(initial.nicknames.join(", "));
  const [birthdate, setBirthdate] = useState(initial.birthdate ?? "");
  const [gender, setGender] = useState(initial.gender ?? "");
  const [tagId, setTagId] = useState<number | null>(initial.tagId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancelEdit() {
    setName(person.name);
    setNicknames(person.nicknames.join(", "));
    setBirthdate(person.birthdate ?? "");
    setGender(person.gender ?? "");
    setTagId(person.tagId);
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
      const res = await fetch(`/api/people/${person.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          nicknames: nicknames
            .split(",")
            .map((n) => n.trim())
            .filter(Boolean),
          birthdate: birthdate.trim() || null,
          gender: gender.trim() || null,
          tagId,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      setPerson(body as PersonCatalogItem);
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
        <Link href="/manage/people" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; People
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{editing ? "Edit person" : person.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="person-name">Name</Label>
                <Input id="person-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="person-birthdate">Birthdate</Label>
                <Input
                  id="person-birthdate"
                  type="date"
                  value={birthdate}
                  onChange={(e) => setBirthdate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="person-gender">Gender</Label>
                <Input id="person-gender" value={gender} onChange={(e) => setGender(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="person-tag">Tag</Label>
                <TagPicker
                  id="person-tag"
                  tags={tags}
                  value={tagId}
                  onChange={setTagId}
                  onTagCreated={(t) => setTags((prev) => (prev.some((x) => x.id === t.id) ? prev : [...prev, t]))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="person-nicknames">Nicknames</Label>
                <Input
                  id="person-nicknames"
                  value={nicknames}
                  onChange={(e) => setNicknames(e.target.value)}
                  placeholder="Nick, Rob, Tom"
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
                <dt className="text-muted-foreground">Birthdate</dt>
                <dd>{person.birthdate ?? "—"}</dd>
                <dt className="text-muted-foreground">Gender</dt>
                <dd>{person.gender ?? "—"}</dd>
                <dt className="text-muted-foreground">Tag</dt>
                <dd>
                  {person.tagName ? (
                    <span className="inline-flex items-center gap-1.5">
                      {person.tagColor ? (
                        <span
                          aria-hidden
                          className="inline-block size-2.5 rounded-full"
                          style={{ backgroundColor: person.tagColor }}
                        />
                      ) : null}
                      {person.tagName}
                    </span>
                  ) : (
                    "—"
                  )}
                </dd>
                <dt className="text-muted-foreground">Nicknames</dt>
                <dd>{person.nicknames.length > 0 ? person.nicknames.join(", ") : "—"}</dd>
              </dl>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <DeleteCatalogItem
                  itemLabel={person.name}
                  isBlocked={usage.dates.length > 0}
                  afterDeleteHref="/manage/people"
                  onDelete={async () => {
                    const res = await fetch(`/api/people/${person.id}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Failed to delete");
                  }}
                  blockedContent={
                    <ul className="list-inside list-disc">
                      {usage.dates.map((date) => (
                        <li key={date}>
                          <Link href={`/day/${date}/people`} className="text-primary hover:underline">
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
