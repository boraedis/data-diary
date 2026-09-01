"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";

type NameCatalogItem = { id: number; name: string };

/** Generic "pick from a small, flat, name-only catalog" field — a plain
 * styled `Select` (same as every other small-option-set field in this app,
 * e.g. Day type in happiness-entry-form.tsx) rather than a free-text input,
 * plus a "+ New" modal so a brand-new value gets added to the catalog on
 * the spot, mirroring the sports league/team pickers' Select+"+ New" shape.
 * The value is still the catalog item's plain name string, not its id —
 * matching every locationType/gameType-style column staying free text, not
 * an FK, so a value that predates (or isn't yet in) the catalog still
 * renders correctly. One shared implementation for every flat name-only
 * catalog (entertainmentLocationTypes, sportsGameTypes, ...) instead of a
 * near-identical copy per catalog — unlike most of this app's per-catalog
 * "+ New" modals, this one's fields never differ (always just a name), so
 * there's nothing bespoke to lose by sharing it. */
export function NameCatalogField({
  id,
  value,
  onChange,
  items,
  onCreated,
  apiPath,
  modalTitle,
}: {
  id: string;
  value: string | null;
  onChange: (value: string | null) => void;
  items: NameCatalogItem[];
  onCreated: (item: NameCatalogItem) => void;
  /** e.g. "/api/entertainment-location-types" or "/api/sports-game-types" */
  apiPath: string;
  modalTitle: string;
}) {
  const hasUnlistedValue = value !== null && !items.some((item) => item.name === value);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      const created = body as NameCatalogItem;
      onCreated(created);
      onChange(created.name);
      setName("");
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
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="flex-1"
        >
          <option value="">None</option>
          {hasUnlistedValue ? <option value={value ?? ""}>{value}</option> : null}
          {items.map((item) => (
            <option key={item.id} value={item.name}>
              {item.name}
            </option>
          ))}
        </Select>
        <Button type="button" variant="outline" size="sm" onClick={() => setModalOpen(true)}>
          + New
        </Button>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={modalTitle}>
        <div className="flex flex-col gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-new-name`}>Name</Label>
            <Input id={`${id}-new-name`} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          {error ? <span className="text-sm text-destructive">{error}</span> : null}
          <Button type="button" onClick={handleCreate} disabled={creating || !name.trim()}>
            {creating ? "Adding…" : "Add"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
