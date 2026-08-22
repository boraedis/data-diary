"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { SearchCombobox } from "@/components/entry-forms/search-combobox";
import type { SearchItem } from "@/components/entry-forms/search-panel";

export type CatalogItem = { id: number; name: string };

/**
 * Search-and-select-from-catalog + "+ New" modal, for simple (id, name[,
 * extra fields]) catalogs that don't warrant their own dedicated picker —
 * currently just exercise locations (people/places/exercises/entertainment
 * each have richer fields and get their own picker/form instead). Built on
 * SearchCombobox rather than a plain `<select>` for the same reason as the
 * other pickers: once a catalog has more than a handful of entries, a plain
 * dropdown stops being usable. `toSearchItem` lets a caller add a
 * disambiguating secondary line (e.g. showing a location's category).
 */
export function CatalogPicker<T extends CatalogItem>({
  id,
  itemLabel,
  items,
  toSearchItem,
  valueId,
  onChange,
  onCreated,
  createApiPath,
  addLabel,
  extraCreateFields,
}: {
  id: string;
  itemLabel: string;
  items: T[];
  toSearchItem?: (item: T) => SearchItem;
  valueId: number | null;
  onChange: (id: number | null) => void;
  onCreated: (item: T) => void;
  createApiPath: string;
  addLabel: string;
  extraCreateFields?: Record<string, unknown>;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchItems: SearchItem[] = items.map((item) =>
    toSearchItem ? toSearchItem(item) : { id: item.id, primary: item.name }
  );

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
      const created = body as T;
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
        <SearchCombobox
          id={id}
          items={searchItems}
          valueId={valueId}
          onChange={onChange}
          placeholder={`Search ${itemLabel.toLowerCase()}s…`}
        />
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
