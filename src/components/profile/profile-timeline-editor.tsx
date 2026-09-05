"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ColorInput } from "@/components/ui/color-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { SearchPanel, type SearchItem } from "@/components/entry-forms/search-panel";
import { SearchCombobox } from "@/components/entry-forms/search-combobox";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import { TimelinePreviewChart } from "@/components/profile/timeline-preview-chart";
import type {
  ProfileOccupationItem,
  ProfileOccupationRole,
  ProfileRelationshipItem,
  ProfileResidenceItem,
} from "@/lib/profile";

export type ProfileEntryType = "occupation" | "residence" | "relationship";
export type ProfileEntry = ProfileOccupationItem | ProfileResidenceItem | ProfileRelationshipItem;

type PickerOption = { id: number; name: string };

// "occupation" -> "/api/profile/occupations", etc. — every profile timeline
// API route follows this same plural-of-the-type naming (see src/lib/
// profile.ts and src/app/api/profile/**).
const API_PATHS: Record<ProfileEntryType, string> = {
  occupation: "/api/profile/occupations",
  residence: "/api/profile/residences",
  relationship: "/api/profile/relationships",
};

function formatRange(start: string, end: string | null): string {
  return end ? `${start} – ${end}` : `${start} – present`;
}

function secondaryLine(type: ProfileEntryType, entry: ProfileEntry): string | null {
  if (type === "occupation") {
    const e = entry as ProfileOccupationItem;
    return [e.position, e.company].filter(Boolean).join(" at ") || e.placeName;
  }
  if (type === "residence") return (entry as ProfileResidenceItem).placeName;
  return (entry as ProfileRelationshipItem).personName;
}

/**
 * One generic, type-driven CRUD editor for all three profile timelines
 * (occupation/residence/relationship) — see #11's issue thread, which
 * explicitly calls out mirroring legacy's single generic editor
 * (`/entry/profile/edit?type=...`) rather than three bespoke forms. A
 * searchable list (SearchPanel) + a small preview timeline chart + an
 * add/edit modal whose fields swap based on `type`, all in one component.
 *
 * Roles (occupation only — see the `profileOccupationRoles` table comment)
 * are managed inside the edit modal once an occupation already exists;
 * they're hidden while creating a new one since a role needs a real
 * occupationId to attach to.
 */
export function ProfileTimelineEditor({
  type,
  title,
  entries: initialEntries,
  places,
  people,
}: {
  type: ProfileEntryType;
  title: string;
  entries: ProfileEntry[];
  places?: PickerOption[];
  people?: PickerOption[];
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProfileEntry | null>(null);

  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [alias, setAlias] = useState("");
  const [color, setColor] = useState("");
  const [position, setPosition] = useState("");
  const [company, setCompany] = useState("");
  const [placeId, setPlaceId] = useState<number | null>(null);
  const [personId, setPersonId] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rolePosition, setRolePosition] = useState("");
  const [roleStart, setRoleStart] = useState("");
  const [roleEnd, setRoleEnd] = useState("");
  const [addingRole, setAddingRole] = useState(false);

  function openCreate() {
    setEditing(null);
    setName("");
    setStart("");
    setEnd("");
    setAlias("");
    setColor("");
    setPosition("");
    setCompany("");
    setPlaceId(null);
    setPersonId(null);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(entry: ProfileEntry) {
    setEditing(entry);
    setName(entry.name);
    setStart(entry.start);
    setEnd(entry.end ?? "");
    setAlias(entry.alias ?? "");
    setColor(entry.color ?? "");
    if (type === "occupation") {
      const e = entry as ProfileOccupationItem;
      setPosition(e.position ?? "");
      setCompany(e.company ?? "");
      setPlaceId(e.placeId);
    } else if (type === "residence") {
      setPlaceId((entry as ProfileResidenceItem).placeId);
    } else {
      setPersonId((entry as ProfileRelationshipItem).personId);
    }
    setError(null);
    setModalOpen(true);
  }

  async function handleSave() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!start) {
      setError("Start date is required");
      return;
    }
    if (type === "residence" && placeId === null) {
      setError("Place is required");
      return;
    }
    if (type === "relationship" && personId === null) {
      setError("Person is required");
      return;
    }

    const body: Record<string, unknown> = {
      name: name.trim(),
      start,
      end: end || null,
      alias: alias.trim() || null,
      color: color.trim() || null,
    };
    if (type === "occupation") {
      body.position = position.trim() || null;
      body.company = company.trim() || null;
      body.placeId = placeId;
    } else if (type === "residence") {
      body.placeId = placeId;
    } else {
      body.personId = personId;
    }

    setSaving(true);
    setError(null);
    try {
      const url = editing ? `${API_PATHS[type]}/${editing.id}` : API_PATHS[type];
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const saved = await res.json();
      if (!res.ok) {
        setError(typeof saved?.error === "string" ? saved.error : "Failed to save");
        return;
      }
      setEntries((prev) => {
        if (editing) return prev.map((e) => (e.id === saved.id ? saved : e));
        return [saved, ...prev];
      });
      setEditing(saved);
      if (!editing) {
        // Stay open on create so roles can be added right away for an
        // occupation, matching how a place/person "+ New" flow lands you
        // straight into an editable state.
        if (type !== "occupation") setModalOpen(false);
      } else {
        setModalOpen(false);
      }
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddRole() {
    if (!editing || !rolePosition.trim() || !roleStart) return;
    setAddingRole(true);
    try {
      const res = await fetch(`/api/profile/occupations/${editing.id}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position: rolePosition.trim(), start: roleStart, end: roleEnd || null }),
      });
      const role = (await res.json()) as ProfileOccupationRole;
      if (!res.ok) return;
      const updated = { ...(editing as ProfileOccupationItem), roles: [...(editing as ProfileOccupationItem).roles, role] };
      setEditing(updated);
      setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setRolePosition("");
      setRoleStart("");
      setRoleEnd("");
    } finally {
      setAddingRole(false);
    }
  }

  async function handleDeleteRole(roleId: number) {
    if (!editing) return;
    await fetch(`/api/profile/occupation-roles/${roleId}`, { method: "DELETE" });
    const updated = {
      ...(editing as ProfileOccupationItem),
      roles: (editing as ProfileOccupationItem).roles.filter((r) => r.id !== roleId),
    };
    setEditing(updated);
    setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  }

  const searchItems: SearchItem[] = entries.map((entry) => ({
    id: entry.id,
    primary: entry.name,
    secondary: secondaryLine(type, entry),
    caption: formatRange(entry.start, entry.end),
    accentColor: entry.color,
  }));

  const editingOccupation = type === "occupation" && editing ? (editing as ProfileOccupationItem) : null;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <TimelinePreviewChart entries={entries.map((e) => ({ id: e.id, name: e.name, start: e.start, end: e.end, color: e.color }))} />

        <SearchPanel
          items={searchItems}
          onSelect={(id) => {
            const entry = entries.find((e) => e.id === id);
            if (entry) openEdit(entry);
          }}
          placeholder={`Search ${title.toLowerCase()}…`}
          emptyMessage="Nothing logged yet."
          trailingAction={
            <Button type="button" variant="outline" size="xs" onClick={openCreate}>
              + New
            </Button>
          }
        />
      </CardContent>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${title.toLowerCase()} entry` : `New ${title.toLowerCase()} entry`}
      >
        <div className="flex flex-col gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="pte-name">Name</Label>
            <Input id="pte-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>

          {type === "occupation" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="pte-position">Position</Label>
                <Input id="pte-position" value={position} onChange={(e) => setPosition(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pte-company">Company</Label>
                <Input id="pte-company" value={company} onChange={(e) => setCompany(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pte-place">Place</Label>
                <SearchCombobox
                  id="pte-place"
                  items={(places ?? []).map((p) => ({ id: p.id, primary: p.name }))}
                  valueId={placeId}
                  onChange={setPlaceId}
                  placeholder="Search places…"
                />
              </div>
            </>
          ) : null}

          {type === "residence" ? (
            <div className="space-y-1.5">
              <Label htmlFor="pte-place">Place</Label>
              <SearchCombobox
                id="pte-place"
                items={(places ?? []).map((p) => ({ id: p.id, primary: p.name }))}
                valueId={placeId}
                onChange={setPlaceId}
                placeholder="Search places…"
              />
            </div>
          ) : null}

          {type === "relationship" ? (
            <div className="space-y-1.5">
              <Label htmlFor="pte-person">Person</Label>
              <SearchCombobox
                id="pte-person"
                items={(people ?? []).map((p) => ({ id: p.id, primary: p.name }))}
                valueId={personId}
                onChange={setPersonId}
                placeholder="Search people…"
              />
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pte-start">Start date</Label>
              <Input id="pte-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pte-end">End date</Label>
              <Input id="pte-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              <p className="text-xs text-muted-foreground">Leave blank if ongoing.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pte-alias">Alias</Label>
              <Input id="pte-alias" value={alias} onChange={(e) => setAlias(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pte-color">Color</Label>
              <ColorInput id="pte-color" value={color} onChange={setColor} />
            </div>
          </div>

          {error ? <span className="text-sm text-destructive">{error}</span> : null}

          <div className="flex gap-2">
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {editing ? (
              <DeleteCatalogItem
                itemLabel={editing.name}
                isBlocked={false}
                blockedContent={null}
                onDelete={async () => {
                  const res = await fetch(`${API_PATHS[type]}/${editing.id}`, { method: "DELETE" });
                  if (!res.ok) throw new Error("Failed to delete");
                  setEntries((prev) => prev.filter((e) => e.id !== editing.id));
                  setModalOpen(false);
                }}
              />
            ) : null}
          </div>

          {editingOccupation ? (
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <Label>Roles</Label>
              {editingOccupation.roles.length === 0 ? (
                <p className="text-sm text-muted-foreground">No roles logged — e.g. promotions or title changes.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {editingOccupation.roles.map((role) => (
                    <li key={role.id} className="flex items-center justify-between gap-2 text-sm">
                      <span>
                        {role.position}{" "}
                        <span className="text-muted-foreground">({formatRange(role.start, role.end)})</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteRole(role.id)}
                        aria-label={`Remove ${role.position}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        &times;
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pte-role-position">New role</Label>
                  <Input
                    id="pte-role-position"
                    value={rolePosition}
                    onChange={(e) => setRolePosition(e.target.value)}
                    placeholder="Senior Engineer"
                  />
                </div>
                <Input
                  type="date"
                  aria-label="Role start date"
                  value={roleStart}
                  onChange={(e) => setRoleStart(e.target.value)}
                  className="w-36"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddRole}
                  disabled={addingRole || !rolePosition.trim() || !roleStart}
                >
                  Add
                </Button>
              </div>
            </div>
          ) : type === "occupation" && !editing ? (
            <p className="text-xs text-muted-foreground">Save this occupation first to add roles.</p>
          ) : null}
        </div>
      </Modal>
    </Card>
  );
}
