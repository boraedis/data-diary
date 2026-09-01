"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import type { SleepLocationSubtypeItem, SleepLocationTypeItem } from "@/lib/catalog-admin";

type TypeWithSubtypes = SleepLocationTypeItem & { subtypes: SleepLocationSubtypeItem[] };

/** Sleep "location" / "location detail" pair (days.sleepLocationType/
 * sleepLocationSubtype), backed by the sleepLocationTypes/
 * sleepLocationSubtypes catalog (issue #59) — both fields stay free text
 * (see the `days` table comment in schema.ts), rendered as plain styled
 * `Select`s (same as every other small-option-set field in this app, e.g.
 * Day type in happiness-entry-form.tsx) rather than free-text inputs, plus a
 * single "+ New" modal that resolves-or-creates both the type and (if given)
 * its subtype in one step, since the day-entry side only has the free-text
 * strings to work from, not a type id. A value that predates this catalog
 * (or isn't in it yet) still renders as a selectable option rather than
 * silently resetting to "None". */
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
  const [modalOpen, setModalOpen] = useState(false);
  const [newType, setNewType] = useState("");
  const [newSubtype, setNewSubtype] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matchedType = items.find((t) => t.name === type);
  const subtypeOptions = matchedType ? matchedType.subtypes : items.flatMap((t) => t.subtypes);
  const hasUnlistedType = type !== null && !items.some((t) => t.name === type);
  const hasUnlistedSubtype = subtype !== null && !subtypeOptions.some((s) => s.name === subtype);

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
        <Select id="sleepLocationType" value={type ?? ""} onChange={(e) => onTypeChange(e.target.value || null)}>
          <option value="">None</option>
          {hasUnlistedType ? <option value={type ?? ""}>{type}</option> : null}
          {items.map((t) => (
            <option key={t.id} value={t.name}>
              {t.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sleepLocationSubtype">Sleep location detail</Label>
        <div className="flex items-center gap-2">
          <Select
            id="sleepLocationSubtype"
            value={subtype ?? ""}
            onChange={(e) => onSubtypeChange(e.target.value || null)}
            className="flex-1"
          >
            <option value="">None</option>
            {hasUnlistedSubtype ? <option value={subtype ?? ""}>{subtype}</option> : null}
            {subtypeOptions.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </Select>
          <Button type="button" variant="outline" size="sm" onClick={openModal}>
            + New
          </Button>
        </div>
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
