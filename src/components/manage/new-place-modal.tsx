"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import type { PlaceCatalogItem } from "@/lib/days";

/** Same fields/shape as the places entry form's own "+ New" modal — kept as
 * a separate copy rather than importing that one, since it's private to
 * that file and the entry-form and manage contexts are reasonable to let
 * drift independently (same call already made for people/entertainment). */
export function NewPlaceModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (item: PlaceCatalogItem) => void;
}) {
  const [name, setName] = useState("");
  const [alias, setAlias] = useState("");
  const [address, setAddress] = useState("");
  const [category, setCategory] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setAlias("");
    setAddress("");
    setCategory("");
    setError(null);
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          alias: alias.trim() || null,
          address: address.trim() || null,
          category: category.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      onCreated(body as PlaceCatalogItem);
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
      title="New place"
    >
      <div className="flex flex-col gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="manage-new-place-name">Name</Label>
          <Input id="manage-new-place-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manage-new-place-alias">Alias</Label>
          <Input id="manage-new-place-alias" value={alias} onChange={(e) => setAlias(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manage-new-place-address">Address</Label>
          <Input id="manage-new-place-address" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manage-new-place-category">Category</Label>
          <Input
            id="manage-new-place-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="restaurant, gym, friend's place…"
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
