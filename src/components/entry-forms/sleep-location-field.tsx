"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import type { SleepLocationSubtypeItem, SleepLocationTypeItem } from "@/lib/catalog-admin";

type TypeWithSubtypes = SleepLocationTypeItem & { subtypes: SleepLocationSubtypeItem[] };

/** Sleep "location" / "location detail" pair (days.sleepLocationType/
 * sleepLocationSubtype), backed by the sleepLocationTypes/
 * sleepLocationSubtypes catalog (issue #59) — both fields stay free text
 * (see the `days` table comment in schema.ts), with catalog names offered
 * as suggestions via Input+datalist (same pattern place-detail.tsx uses for
 * category/subcategory) plus a single "+ New" modal that resolves-or-creates
 * both the type and (if given) its subtype in one step, since the day-entry
 * side only has the free-text strings to work from, not a type id. */
export function SleepLocationField({
  type,
  subtype,
  onTypeChange,
  onSubtypeChange,
  items,
  onCreated,
}: {
  type: string | null;
  subtype: string | null;
  onTypeChange: (value: string | null) => void;
  onSubtypeChange: (value: string | null) => void;
  items: TypeWithSubtypes[];
  onCreated: (type: TypeWithSubtypes) => void;
}) {
  const typeListId = useId();
  const subtypeListId = useId();
  const [modalOpen, setModalOpen] = useState(false);
  const [newType, setNewType] = useState("");
  const [newSubtype, setNewSubtype] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matchedType = items.find((t) => t.name === type);
  const subtypeOptions = matchedType ? matchedType.subtypes : items.flatMap((t) => t.subtypes);

  function openModal() {
    setNewType(type ?? "");
    setNewSubtype(subtype ?? "");
    setError(null);
    setModalOpen(true);
  }

  async function handleCreate() {
    if (!newType.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const typeRes = await fetch("/api/sleep-location-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newType.trim() }),
      });
      const typeBody = await typeRes.json();
      if (!typeRes.ok) {
        setError(typeof typeBody?.error === "string" ? typeBody.error : "Failed to create");
        return;
      }
      const createdType = typeBody as SleepLocationTypeItem;

      let createdSubtype: SleepLocationSubtypeItem | null = null;
      if (newSubtype.trim()) {
        const subtypeRes = await fetch(`/api/sleep-location-types/${createdType.id}/subtypes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newSubtype.trim() }),
        });
        const subtypeBody = await subtypeRes.json();
        if (!subtypeRes.ok) {
          setError(typeof subtypeBody?.error === "string" ? subtypeBody.error : "Failed to create subtype");
          return;
        }
        createdSubtype = subtypeBody as SleepLocationSubtypeItem;
      }

      onCreated({ ...createdType, subtypes: createdSubtype ? [createdSubtype] : [] });
      onTypeChange(createdType.name);
      onSubtypeChange(createdSubtype?.name ?? null);
      setModalOpen(false);
    } catch {
      setError("Network error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="sleepLocationType">Sleep location</Label>
        <Input
          id="sleepLocationType"
          list={typeListId}
          placeholder="e.g. home"
          value={type ?? ""}
          onChange={(e) => onTypeChange(e.target.value || null)}
        />
        <datalist id={typeListId}>
          {items.map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sleepLocationSubtype">Sleep location detail</Label>
        <div className="flex items-center gap-2">
          <Input
            id="sleepLocationSubtype"
            list={subtypeListId}
            placeholder="e.g. own bed"
            value={subtype ?? ""}
            onChange={(e) => onSubtypeChange(e.target.value || null)}
            className="flex-1"
          />
          <Button type="button" variant="outline" size="sm" onClick={openModal}>
            + New
          </Button>
        </div>
        <datalist id={subtypeListId}>
          {subtypeOptions.map((s) => (
            <option key={s.id} value={s.name} />
          ))}
        </datalist>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New sleep location">
        <div className="flex flex-col gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-sleep-location-type">Type</Label>
            <Input id="new-sleep-location-type" value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="e.g. home" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-sleep-location-subtype">Detail (optional)</Label>
            <Input
              id="new-sleep-location-subtype"
              value={newSubtype}
              onChange={(e) => setNewSubtype(e.target.value)}
              placeholder="e.g. own bed"
            />
          </div>
          {error ? <span className="text-sm text-destructive">{error}</span> : null}
          <Button type="button" onClick={handleCreate} disabled={creating || !newType.trim()}>
            {creating ? "Adding…" : "Add"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
