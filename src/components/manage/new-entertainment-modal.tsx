"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { ENTERTAINMENT_KIND_LABELS } from "@/components/entry-forms/entertainment-entry-form";
import type { EntertainmentCatalogItem } from "@/lib/days";
import type { EntertainmentKind } from "@/db/schema";

export function NewEntertainmentModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (item: EntertainmentCatalogItem) => void;
}) {
  const [kind, setKind] = useState<EntertainmentKind>("movie");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setKind("movie");
    setTitle("");
    setDetail("");
    setError(null);
  }

  async function handleCreate() {
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/entertainment-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, title: title.trim(), detail: detail.trim() || null }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      onCreated(body as EntertainmentCatalogItem);
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
      title="New entertainment"
    >
      <div className="flex flex-col gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="manage-new-entertainment-kind">Kind</Label>
          <Select
            id="manage-new-entertainment-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as EntertainmentKind)}
          >
            {Object.entries(ENTERTAINMENT_KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manage-new-entertainment-title">Title</Label>
          <Input
            id="manage-new-entertainment-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manage-new-entertainment-detail">Detail</Label>
          <Input
            id="manage-new-entertainment-detail"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="year, author, platform…"
          />
        </div>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        <Button type="button" onClick={handleCreate} disabled={creating || !title.trim()}>
          {creating ? "Adding…" : "Add"}
        </Button>
      </div>
    </Modal>
  );
}
