"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ColorInput } from "@/components/ui/color-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import type { TagCatalogItem } from "@/lib/catalog-admin";

/** Same shape as TagPicker's own inline NewTagModal (src/components/tag-picker.tsx)
 * — kept as a separate copy for the manage list's "+ New tag" button, same
 * reasoning as every other catalog's manage-vs-entry-form modal split. */
export function NewTagModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (tag: TagCatalogItem & { memberCount: number }) => void;
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
      onCreated({ ...(body as TagCatalogItem), memberCount: 0 });
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
          <ColorInput id="new-tag-color" value={color} onChange={setColor} />
        </div>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        <Button type="button" onClick={handleCreate} disabled={creating || !name.trim()}>
          {creating ? "Adding…" : "Add"}
        </Button>
      </div>
    </Modal>
  );
}
