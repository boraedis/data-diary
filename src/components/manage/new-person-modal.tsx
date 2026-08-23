"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import type { PersonCatalogItem } from "@/lib/days";

/** Same "+ New" pattern as places/entertainment's own modals, just for the
 * People catalog's fields. Nicknames are entered comma-separated (matching
 * the legacy app's person.js) rather than as a real multi-input list — one
 * text field is plenty for something typed rarely. `tag` is free text here
 * rather than the legacy app's color-coded tag catalog (`entry/database/
 * people/tags`), same "downgrade to free text until it's worth building for
 * real" call already made for places' `category` and entertainment's
 * `detail`. */
export function NewPersonModal({
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
          birthdate: birthdate.trim() || null,
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
        <div className="space-y-1.5">
          <Label htmlFor="new-person-tag">Tag</Label>
          <Input id="new-person-tag" value={tag} onChange={(e) => setTag(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-person-nicknames">Nicknames</Label>
          <Input
            id="new-person-nicknames"
            value={nicknames}
            onChange={(e) => setNicknames(e.target.value)}
            placeholder="Nick, Rob, Tom"
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
