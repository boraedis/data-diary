"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { DurationInput } from "@/components/ui/duration-input";
import { NameCatalogField } from "@/components/entry-forms/name-catalog-field";
import { usePendingOpenMatch, type PendingOpen } from "@/lib/use-pending-open";
import type { EntertainmentLocationTypeItem, GameCategoryItem, GameDeviceItem, GameSubcategoryItem } from "@/lib/catalog-admin";
import type { GameCatalogItem } from "@/lib/days";

export type GameRow = {
  gameId: number;
  durationMinutes: number | null;
  device: string | null;
  locationType: string | null;
};

/** "+ New game" catalog-creation modal — name plus an optional type/
 * subtype, sourced from the real gameCategories/gameSubcategories catalogs
 * (issue #68) the same datalist-backed way NewPlaceModal sources places'
 * category/subcategory, rather than a free-typed field. */
function NewGameModal({
  open,
  onClose,
  onCreated,
  categories,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (item: GameCatalogItem) => void;
  categories: (GameCategoryItem & { subcategories: GameSubcategoryItem[] })[];
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [subtype, setSubtype] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typeNames = categories.map((c) => c.name);
  const subtypeNames = categories.flatMap((c) => c.subcategories.map((s) => s.name));

  function reset() {
    setName("");
    setType("");
    setSubtype("");
    setError(null);
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type: type.trim() || null, subtype: subtype.trim() || null }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      onCreated(body as GameCatalogItem);
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
      title="New game"
    >
      <div className="flex flex-col gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="new-game-name">Name</Label>
          <Input id="new-game-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-game-type">Category</Label>
          <Input id="new-game-type" list="new-game-type-options" value={type} onChange={(e) => setType(e.target.value)} />
          <datalist id="new-game-type-options">
            {typeNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-game-subtype">Subcategory</Label>
          <Input
            id="new-game-subtype"
            list="new-game-subtype-options"
            value={subtype}
            onChange={(e) => setSubtype(e.target.value)}
          />
          <datalist id="new-game-subtype-options">
            {subtypeNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        <Button type="button" onClick={handleCreate} disabled={creating || !name.trim()}>
          {creating ? "Adding…" : "Add"}
        </Button>
      </div>
    </Modal>
  );
}

/** The "log this session" modal — duration, device, and where (issue #68),
 * same baseline shape as EntertainmentDetailModal in
 * other-entertainment-section.tsx. */
function GameSessionDetailModal({
  open,
  game,
  initial,
  devices,
  onDeviceCreated,
  locationTypes,
  onLocationTypeCreated,
  onClose,
  onSave,
}: {
  open: boolean;
  game: GameCatalogItem | null;
  initial: Omit<GameRow, "gameId"> | null;
  devices: GameDeviceItem[];
  onDeviceCreated: (item: GameDeviceItem) => void;
  locationTypes: EntertainmentLocationTypeItem[];
  onLocationTypeCreated: (item: EntertainmentLocationTypeItem) => void;
  onClose: () => void;
  onSave: (value: Omit<GameRow, "gameId">) => void;
}) {
  const [durationMinutes, setDurationMinutes] = useState<number | null>(initial?.durationMinutes ?? null);
  const [device, setDevice] = useState(initial?.device ?? "");
  const [locationType, setLocationType] = useState(initial?.locationType ?? "");

  return (
    <Modal open={open} onClose={onClose} title={game?.name ?? ""}>
      {game ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {[game.type, game.subtype].filter(Boolean).join(" · ") || null}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="game-detail-duration">Time played</Label>
            <DurationInput id="game-detail-duration" totalMinutes={durationMinutes} onChange={setDurationMinutes} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="game-detail-device">Device</Label>
            <NameCatalogField
              id="game-detail-device"
              value={device || null}
              onChange={(value) => setDevice(value ?? "")}
              items={devices}
              onCreated={onDeviceCreated}
              apiPath="/api/game-devices"
              modalTitle="New device"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="game-detail-location">Where</Label>
            <NameCatalogField
              id="game-detail-location"
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
            onClick={() =>
              onSave({ durationMinutes, device: device.trim() || null, locationType: locationType.trim() || null })
            }
          >
            Save
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}

/** An already-cataloged game is picked via the shared top-level unified
 * search in entertainment-day-form.tsx (same as every other kind there) —
 * this section only owns "+ New game" for a genuinely new one, matching
 * other-entertainment-section.tsx's shape (issue #68). */
export function GamesSection({
  catalog,
  categories,
  devices: initialDevices,
  locationTypes,
  onLocationTypeCreated,
  rows,
  onRowsChange,
  pendingOpen,
}: {
  catalog: GameCatalogItem[];
  categories: (GameCategoryItem & { subcategories: GameSubcategoryItem[] })[];
  devices: GameDeviceItem[];
  locationTypes: EntertainmentLocationTypeItem[];
  onLocationTypeCreated: (item: EntertainmentLocationTypeItem) => void;
  rows: GameRow[];
  onRowsChange: (rows: GameRow[]) => void;
  pendingOpen: PendingOpen;
}) {
  const [items, setItems] = useState<GameCatalogItem[]>(catalog);
  const [devices, setDevices] = useState<GameDeviceItem[]>(initialDevices);
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [detail, setDetail] = useState<{ game: GameCatalogItem; editIndex: number | null } | null>(null);

  const editingRow = detail?.editIndex !== null && detail?.editIndex !== undefined ? rows[detail.editIndex] : null;

  const pendingGameId = usePendingOpenMatch(pendingOpen, "game");
  if (pendingGameId !== null) {
    const game = items.find((g) => g.id === pendingGameId);
    if (game) setDetail({ game, editIndex: null });
  }

  function handleCreated(item: GameCatalogItem) {
    setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)));
    setDetail({ game: item, editIndex: null });
  }

  function handleDeviceCreated(item: GameDeviceItem) {
    setDevices((prev) => (prev.some((d) => d.id === item.id) ? prev : [...prev, item].sort((a, b) => a.name.localeCompare(b.name))));
  }

  function openForEdit(index: number) {
    const row = rows[index];
    const game = items.find((g) => g.id === row.gameId);
    if (!game) return;
    setDetail({ game, editIndex: index });
  }

  function saveDetail(value: Omit<GameRow, "gameId">) {
    if (!detail) return;
    if (detail.editIndex !== null) {
      const next = [...rows];
      next[detail.editIndex] = { gameId: detail.game.id, ...value };
      onRowsChange(next);
    } else {
      onRowsChange([...rows, { gameId: detail.game.id, ...value }]);
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
          <CardTitle>Games</CardTitle>
          <Button type="button" variant="outline" size="xs" onClick={() => setNewModalOpen(true)}>
            + New game
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">None logged yet.</p> : null}
        {rows.map((row, i) => {
          const game = items.find((g) => g.id === row.gameId);
          return (
            <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <button type="button" onClick={() => openForEdit(i)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm">{game?.name ?? "Unknown"}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.durationMinutes ? `${row.durationMinutes} min` : null}
                  {row.device ? ` · ${row.device}` : ""}
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

      <NewGameModal open={newModalOpen} onClose={() => setNewModalOpen(false)} onCreated={handleCreated} categories={categories} />

      <GameSessionDetailModal
        key={detail ? `${detail.game.id}-${detail.editIndex ?? "new"}` : "closed"}
        open={detail !== null}
        game={detail?.game ?? null}
        initial={editingRow ?? null}
        devices={devices}
        onDeviceCreated={handleDeviceCreated}
        locationTypes={locationTypes}
        onLocationTypeCreated={onLocationTypeCreated}
        onClose={() => setDetail(null)}
        onSave={saveDetail}
      />
    </Card>
  );
}
