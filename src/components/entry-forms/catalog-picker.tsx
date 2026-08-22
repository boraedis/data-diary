"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";

export type CatalogItem = { id: number; name: string };

/**
 * Select-from-catalog + "+ New" modal, shared by every plain (id, name)
 * catalog in this app (people, places). Picking always beats free text
 * here — the whole point of a catalog is that "Mom" means the same row
 * every time, not a new string each entry. `extraCreateFields` lets a
 * caller send additional fixed fields on create without needing a second
 * component (used by the exercise-location picker to carry the exercise's
 * category along with the new location's name).
 */
export function CatalogPicker({
  id,
  itemLabel,
  items,
  valueId,
  onChange,
  onCreated,
  createApiPath,
  addLabel,
  extraCreateFields,
}: {
  id: string;
  itemLabel: string;
  items: CatalogItem[];
  valueId: number | null;
  onChange: (id: number | null) => void;
  onCreated: (item: CatalogItem) => void;
  createApiPath: string;
  addLabel: string;
  extraCreateFields?: Record<string, unknown>;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(createApiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), ...extraCreateFields }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      const created = body as CatalogItem;
      onCreated(created);
      onChange(created.id);
      setNewName("");
      setModalOpen(false);
    } catch {
      setError("Network error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Select
          id={id}
          className="flex-1"
          value={valueId ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">—</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
        <Button type="button" variant="outline" size="xs" onClick={() => setModalOpen(true)}>
          + New
        </Button>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={addLabel}>
        <div className="flex flex-col gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-new-name`}>{itemLabel} name</Label>
            <Input
              id={`${id}-new-name`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
          </div>
          {error ? <span className="text-sm text-destructive">{error}</span> : null}
          <Button type="button" onClick={handleCreate} disabled={creating || !newName.trim()}>
            {creating ? "Adding…" : "Add"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
