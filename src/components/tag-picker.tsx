"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import type { TagCatalogItem } from "@/lib/catalog-admin";

/** "+ New tag" — same shape as every other catalog's inline creation modal
 * (NewExerciseModal, NewSportModal, ...), just for the real `tags` table
 * (name + color) that replaced people's old free-text `tag` field. */
function NewTagModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (tag: TagCatalogItem) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#64748b");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setColor("#64748b");
    setError(null);
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), color }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      onCreated(body as TagCatalogItem);
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
      title="New tag"
    >
      <div className="flex flex-col gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="new-tag-name">Name</Label>
          <Input
            id="new-tag-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="family, coworker, friend…"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-tag-color">Color</Label>
          <input
            id="new-tag-color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-10 w-20 cursor-pointer rounded-lg border border-input bg-transparent"
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

/** Dropdown over the real `tags` catalog, with a "+ New" escape hatch — the
 * relationship-tag equivalent of NewExerciseModal's category Select, used
 * everywhere a person's `tagId` is picked (the entry form's "+ New person"
 * modal, the manage "+ New person" modal, and editing an existing person).
 * `tags` is the caller's own state so a freshly-created tag is immediately
 * selectable without a refetch. */
export function TagPicker({
  id,
  tags,
  value,
  onChange,
  onTagCreated,
}: {
  id: string;
  tags: TagCatalogItem[];
  value: number | null;
  onChange: (tagId: number | null) => void;
  onTagCreated: (tag: TagCatalogItem) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <Select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">No tag</option>
        {tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Select>
      <Button type="button" variant="outline" size="sm" onClick={() => setModalOpen(true)}>
        + New
      </Button>
      <NewTagModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(tag) => {
          onTagCreated(tag);
          onChange(tag.id);
        }}
      />
    </div>
  );
}
