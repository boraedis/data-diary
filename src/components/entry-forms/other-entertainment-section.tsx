"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { DurationInput } from "@/components/ui/duration-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NameCatalogField } from "@/components/entry-forms/name-catalog-field";
import { usePendingOpenMatch, type PendingOpen } from "@/lib/use-pending-open";
import type { EntertainmentLocationTypeItem, EntertainmentKindItem } from "@/lib/catalog-admin";
import type { EntertainmentCatalogItem } from "@/lib/days";

export type OtherEntertainmentRow = { entertainmentId: number; durationMinutes: number | null; locationType: string | null };

/** "+ New entertainment" catalog-creation modal — a new entry needs a kind
 * picked alongside its title, since the catalog's identity is (kindId,
 * title) not title alone. Kind choices are restricted to custom
 * (non-system) kinds — Movie/TV show/Sport/Book each have their own
 * dedicated catalog+search, reachable straight from the unified search now
 * (issue #61); creating one here instead would fragment the data (see the
 * entertainmentKinds table comment in schema.ts). */
function NewEntertainmentModal({
  open,
  onClose,
  onCreated,
  kinds,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (item: EntertainmentCatalogItem) => void;
  kinds: EntertainmentKindItem[];
}) {
  const customKinds = kinds.filter((k) => !k.isSystem);
  const [kindId, setKindId] = useState<number | null>(customKinds[0]?.id ?? null);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setKindId(customKinds[0]?.id ?? null);
    setTitle("");
    setDetail("");
    setError(null);
  }

  async function handleCreate() {
    if (!title.trim() || kindId === null) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/entertainment-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kindId, title: title.trim(), detail: detail.trim() || null }),
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
      {customKinds.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Movie/TV show/Sport/Book each have their own search above. To log something else, add a custom kind first
          from the Entertainment manage page.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-entertainment-kind">Kind</Label>
            <Select
              id="new-entertainment-kind"
              value={kindId ?? ""}
              onChange={(e) => setKindId(e.target.value ? Number(e.target.value) : null)}
            >
              {customKinds.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-entertainment-title">Title</Label>
            <Input id="new-entertainment-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-entertainment-detail">Detail</Label>
            <Input
              id="new-entertainment-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="year, author, platform…"
            />
          </div>
          {error ? <span className="text-sm text-destructive">{error}</span> : null}
          <Button type="button" onClick={handleCreate} disabled={creating || !title.trim() || kindId === null}>
            {creating ? "Adding…" : "Add"}
          </Button>
        </div>
      )}
    </Modal>
  );
}

/** The "inner details" modal — opens the moment you pick something (from
 * the unified search, "+ New entertainment", or an already-logged row being
 * edited). Just duration and where (issue #61 narrows this kind down to
 * that baseline, dropping the old free-form Notes field). */
function EntertainmentDetailModal({
  open,
  item,
  initialDurationMinutes,
  initialLocationType,
  locationTypes,
  onLocationTypeCreated,
  onClose,
  onSave,
}: {
  open: boolean;
  item: EntertainmentCatalogItem | null;
  initialDurationMinutes: number | null;
  initialLocationType: string | null;
  locationTypes: EntertainmentLocationTypeItem[];
  onLocationTypeCreated: (item: EntertainmentLocationTypeItem) => void;
  onClose: () => void;
  onSave: (durationMinutes: number | null, locationType: string | null) => void;
}) {
  const [durationMinutes, setDurationMinutes] = useState<number | null>(initialDurationMinutes);
  const [locationType, setLocationType] = useState(initialLocationType ?? "");

  return (
    <Modal open={open} onClose={onClose} title={item?.title ?? ""}>
      {item ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">{item.detail ? `${item.kindName} · ${item.detail}` : item.kindName}</p>
          <div className="space-y-1.5">
            <Label htmlFor="entertainment-detail-duration">Duration</Label>
            <DurationInput id="entertainment-detail-duration" totalMinutes={durationMinutes} onChange={setDurationMinutes} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entertainment-detail-location">Where</Label>
            <NameCatalogField
              id="entertainment-detail-location"
              value={locationType || null}
              onChange={(value) => setLocationType(value ?? "")}
              items={locationTypes}
              onCreated={onLocationTypeCreated}
              apiPath="/api/entertainment-location-types"
              modalTitle="New location type"
            />
          </div>
          <Button
            type="button"
            disabled={!locationType.trim() || durationMinutes === null}
            onClick={() => onSave(durationMinutes, locationType.trim() || null)}
          >
            Save
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}

export function OtherEntertainmentSection({
  catalog,
  kinds,
  locationTypes,
  onLocationTypeCreated,
  rows,
  onRowsChange,
  pendingOpen,
}: {
  catalog: EntertainmentCatalogItem[];
  kinds: EntertainmentKindItem[];
  locationTypes: EntertainmentLocationTypeItem[];
  onLocationTypeCreated: (item: EntertainmentLocationTypeItem) => void;
  rows: OtherEntertainmentRow[];
  onRowsChange: (rows: OtherEntertainmentRow[]) => void;
  pendingOpen: PendingOpen;
}) {
  const [items, setItems] = useState<EntertainmentCatalogItem[]>(catalog);
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [detail, setDetail] = useState<{ item: EntertainmentCatalogItem; editIndex: number | null } | null>(null);

  const editingRow = detail?.editIndex !== null && detail?.editIndex !== undefined ? rows[detail.editIndex] : null;

  const pendingItemId = usePendingOpenMatch(pendingOpen, "other");
  if (pendingItemId !== null) {
    const item = items.find((i) => i.id === pendingItemId);
    if (item) setDetail({ item, editIndex: null });
  }

  function handleCreated(item: EntertainmentCatalogItem) {
    setItems((prev) => [...prev, item].sort((a, b) => a.title.localeCompare(b.title)));
    setDetail({ item, editIndex: null });
  }

  function openForEdit(index: number) {
    const row = rows[index];
    const item = items.find((i) => i.id === row.entertainmentId);
    if (!item) return;
    setDetail({ item, editIndex: index });
  }

  function saveDetail(durationMinutes: number | null, locationType: string | null) {
    if (!detail) return;
    if (detail.editIndex !== null) {
      const next = [...rows];
      next[detail.editIndex] = { entertainmentId: detail.item.id, durationMinutes, locationType };
      onRowsChange(next);
    } else {
      onRowsChange([...rows, { entertainmentId: detail.item.id, durationMinutes, locationType }]);
    }
    setDetail(null);
  }

  function removeRow(index: number) {
    onRowsChange(rows.filter((_, i) => i !== index));
  }

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Other</CardTitle>
          <Button type="button" variant="outline" size="xs" onClick={() => setNewModalOpen(true)}>
            + New entertainment
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">None logged yet.</p> : null}
        {rows.map((row, i) => {
          const item = items.find((it) => it.id === row.entertainmentId);
          return (
            <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <button type="button" onClick={() => openForEdit(i)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm">{item?.title ?? "Unknown"}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {item ? item.kindName : null}
                  {row.durationMinutes ? ` · ${row.durationMinutes} min` : ""}
                  {row.locationType ? ` · ${row.locationType}` : ""}
                </p>
              </button>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove" onClick={() => removeRow(i)}>
                &times;
              </Button>
            </div>
          );
        })}
      </CardContent>

      <NewEntertainmentModal open={newModalOpen} onClose={() => setNewModalOpen(false)} onCreated={handleCreated} kinds={kinds} />

      <EntertainmentDetailModal
        key={detail ? `${detail.item.id}-${detail.editIndex ?? "new"}` : "closed"}
        open={detail !== null}
        item={detail?.item ?? null}
        initialDurationMinutes={editingRow?.durationMinutes ?? null}
        initialLocationType={editingRow?.locationType ?? null}
        locationTypes={locationTypes}
        onLocationTypeCreated={onLocationTypeCreated}
        onClose={() => setDetail(null)}
        onSave={saveDetail}
      />
    </Card>
  );
}
