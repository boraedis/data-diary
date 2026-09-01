"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import type { EntertainmentLocationTypeItem } from "@/lib/catalog-admin";

/** Free-text "Where" field for a movie/TV/book/sports/game entry, backed by
 * the entertainmentLocationTypes catalog (issue #59) — same
 * free-text-but-catalog-suggested relationship places.category has with
 * placeCategories (see place-detail.tsx's Input+datalist), plus a "+ New"
 * modal so a brand-new location gets added to the catalog on the spot,
 * mirroring ExercisePicker's search-or-create shape. */
export function EntertainmentLocationTypeField({
  id,
  value,
  onChange,
  items,
  onCreated,
  placeholder,
}: {
  id: string;
  value: string | null;
  onChange: (value: string | null) => void;
  items: EntertainmentLocationTypeItem[];
  onCreated: (item: EntertainmentLocationTypeItem) => void;
  placeholder?: string;
}) {
  const datalistId = useId();
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/entertainment-location-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      const created = body as EntertainmentLocationTypeItem;
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
        <Input
          id={id}
          list={datalistId}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder={placeholder}
          className="flex-1"
        />
        <datalist id={datalistId}>
          {items.map((item) => (
            <option key={item.id} value={item.name} />
          ))}
        </datalist>
        <Button type="button" variant="outline" size="sm" onClick={() => setModalOpen(true)}>
          + New
        </Button>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New location type">
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
