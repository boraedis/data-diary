"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { SearchPanel, type SearchItem } from "@/components/entry-forms/search-panel";
import {
  NEGATIVE_PEOPLE_SLOTS,
  POSITIVE_PEOPLE_SLOTS,
  type DayPayload,
  type PeoplePayload,
  type PersonCatalogItem,
} from "@/lib/days";

type Valence = "positive" | "negative";
type SlotEntries = { slot: number; valence: Valence; personId: number }[];

function hydrate(entries: SlotEntries, valence: Valence, count: number): (number | null)[] {
  const arr: (number | null)[] = Array(count).fill(null);
  for (const e of entries) {
    if (e.valence === valence && e.slot < count) arr[e.slot] = e.personId;
  }
  return arr;
}

function toSearchItem(person: PersonCatalogItem): SearchItem {
  return {
    id: person.id,
    primary: person.name,
    secondary: person.tag,
    searchTerms: person.nicknames,
  };
}

/** New-person creation form — fields mirror the legacy "New Person" modal
 * (functions/views/entry/database/new_person_form.*): full name,
 * comma-separated nicknames (matched during search, same as the legacy
 * app), an optional birthdate, an optional gender, and an optional
 * relationship "tag" (e.g. "family", "coworker") shown as the search
 * result's secondary line. Only name is required. */
function NewPersonModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (item: PersonCatalogItem) => void;
}) {
  const [name, setName] = useState("");
  const [nicknames, setNicknames] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [gender, setGender] = useState("");
  const [tag, setTag] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setNicknames("");
    setBirthdate("");
    setGender("");
    setTag("");
    setError(null);
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          nicknames: nicknames
            .split(",")
            .map((n) => n.trim())
            .filter(Boolean),
          birthdate: birthdate || null,
          gender: gender.trim() || null,
          tag: tag.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      onCreated(body as PersonCatalogItem);
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
      title="New person"
    >
      <div className="flex flex-col gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="new-person-name">Name</Label>
          <Input id="new-person-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-person-nicknames">Nicknames</Label>
          <Input
            id="new-person-nicknames"
            value={nicknames}
            onChange={(e) => setNicknames(e.target.value)}
            placeholder="comma-separated"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-person-birthdate">Birthdate</Label>
            <Input
              id="new-person-birthdate"
              type="date"
              value={birthdate}
              onChange={(e) => setBirthdate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-person-gender">Gender</Label>
            <Input id="new-person-gender" value={gender} onChange={(e) => setGender(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-person-tag">Tag</Label>
          <Input
            id="new-person-tag"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="family, coworker, friend…"
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

/** The single add panel for both valences: one search box over the shared
 * people catalog (people already used today, on either side, are filtered
 * out so you can't double-pick someone) plus a "+ New person" trigger.
 * Negative people are rare, so positive is the default action — tapping a
 * result adds them as positive, filling the next empty positive slot. The
 * small "−" button on each row is the alternate path, adding that person as
 * negative instead. Either way this mirrors the legacy app's
 * addPositive/addNegative "loop and take the first empty slot" behavior —
 * you never choose a slot by hand, you just populate them in order. */
function PersonAddPanel({
  items,
  usedIds,
  onAddPositive,
  onAddNegative,
  onCreated,
}: {
  items: PersonCatalogItem[];
  usedIds: Set<number>;
  onAddPositive: (personId: number) => void;
  onAddNegative: (personId: number) => void;
  onCreated: (item: PersonCatalogItem) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const searchItems = items.filter((p) => !usedIds.has(p.id)).map(toSearchItem);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Add a person</Label>
        <Button type="button" variant="outline" size="xs" onClick={() => setModalOpen(true)}>
          + New person
        </Button>
      </div>
      <SearchPanel
        items={searchItems}
        onSelect={onAddPositive}
        secondaryAction={{ ariaLabel: "Add as negative", icon: "−", onSelect: onAddNegative }}
        placeholder="Search people…"
        emptyMessage="No matches — try “+ New person”."
      />
      <p className="text-xs text-muted-foreground">
        Tap a result to add as positive. Tap the − to add as negative instead.
      </p>
      <NewPersonModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) => {
          onCreated(item);
          onAddPositive(item.id);
        }}
      />
    </div>
  );
}

function SlotRow({
  index,
  personId,
  people,
  onRemove,
  onPromote,
}: {
  index: number;
  personId: number | null;
  people: PersonCatalogItem[];
  onRemove: () => void;
  onPromote: (() => void) | null;
}) {
  const person = personId !== null ? people.find((p) => p.id === personId) ?? null : null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">
          {index + 1}
          {person ? "" : " — empty"}
        </p>
        {person ? (
          <>
            <p className="truncate text-sm">{person.name}</p>
            {person.tag ? <p className="truncate text-xs text-muted-foreground">{person.tag}</p> : null}
          </>
        ) : null}
      </div>
      {person ? (
        <div className="flex shrink-0 items-center gap-1">
          {onPromote ? (
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Move up" onClick={onPromote}>
              ↑
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove" onClick={onRemove}>
            &times;
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function PeopleEntryForm({
  date,
  initial,
  catalog,
}: {
  date: string;
  initial: PeoplePayload;
  catalog: PersonCatalogItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<PersonCatalogItem[]>(catalog);
  const [positive, setPositive] = useState<(number | null)[]>(() =>
    hydrate(initial.entries, "positive", POSITIVE_PEOPLE_SLOTS)
  );
  const [negative, setNegative] = useState<(number | null)[]>(() =>
    hydrate(initial.entries, "negative", NEGATIVE_PEOPLE_SLOTS)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const usedIds = new Set([...positive, ...negative].filter((v): v is number => v !== null));

  function handleCreated(item: PersonCatalogItem) {
    setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)));
  }

  function addToValence(valence: Valence, personId: number) {
    setSavedAt(null);
    const setter = valence === "positive" ? setPositive : setNegative;
    setter((prev) => {
      const idx = prev.findIndex((v) => v === null);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = personId;
      return next;
    });
  }

  function removeSlot(valence: Valence, slot: number) {
    setSavedAt(null);
    const setter = valence === "positive" ? setPositive : setNegative;
    setter((prev) => prev.map((v, i) => (i === slot ? null : v)));
  }

  function promoteSlot(valence: Valence, slot: number) {
    setSavedAt(null);
    const setter = valence === "positive" ? setPositive : setNegative;
    setter((prev) => {
      if (slot === 0) return prev;
      const next = [...prev];
      [next[slot - 1], next[slot]] = [next[slot], next[slot - 1]];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const entries: PeoplePayload["entries"] = [
      ...positive.map((personId, slot) =>
        personId !== null ? { slot, valence: "positive" as const, personId } : null
      ),
      ...negative.map((personId, slot) =>
        personId !== null ? { slot, valence: "negative" as const, personId } : null
      ),
    ].filter((e): e is PeoplePayload["entries"][number] => e !== null);

    try {
      const res = await fetch(`/api/days/${date}/people`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }

      const saved = body as DayPayload;
      setPositive(hydrate(saved.people, "positive", POSITIVE_PEOPLE_SLOTS));
      setNegative(hydrate(saved.people, "negative", NEGATIVE_PEOPLE_SLOTS));
      setSavedAt(Date.now());
      router.refresh();
    } catch {
      setError("Network error — could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 pb-20">
      <Card size="sm">
        <CardHeader>
          <CardTitle>People</CardTitle>
          <CardDescription>
            {POSITIVE_PEOPLE_SLOTS} positive, {NEGATIVE_PEOPLE_SLOTS} negative (rare). Tap a search
            result to add as positive, or use the − for negative.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase text-muted-foreground">Positive</p>
              {positive.map((personId, slot) => (
                <SlotRow
                  key={`positive-${slot}`}
                  index={slot}
                  personId={personId}
                  people={items}
                  onRemove={() => removeSlot("positive", slot)}
                  onPromote={slot > 0 ? () => promoteSlot("positive", slot) : null}
                />
              ))}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase text-muted-foreground">Negative</p>
              {negative.map((personId, slot) => (
                <SlotRow
                  key={`negative-${slot}`}
                  index={slot}
                  personId={personId}
                  people={items}
                  onRemove={() => removeSlot("negative", slot)}
                  onPromote={slot > 0 ? () => promoteSlot("negative", slot) : null}
                />
              ))}
            </div>
          </div>

          <PersonAddPanel
            items={items}
            usedIds={usedIds}
            onAddPositive={(id) => addToValence("positive", id)}
            onAddNegative={(id) => addToValence("negative", id)}
            onCreated={handleCreated}
          />
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 py-3">
          <span className="text-sm">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : savedAt ? (
              <span className="text-muted-foreground">Saved.</span>
            ) : null}
          </span>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}
