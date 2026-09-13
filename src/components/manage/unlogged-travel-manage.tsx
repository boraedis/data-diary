"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import type { UnloggedTravelKind, UnloggedTravelRow } from "@/lib/unlogged-travel";
import type { TravelSearchResult } from "@/app/api/unlogged-travel/search/route";

// The manage surface for unlogged travel (#367). With no seed, this is
// the only way a row ever enters the table — see #363's own scope note —
// so it has to cover add, edit and remove rather than being a viewer with
// an add button.
//
// One component serving both kinds rather than two: the table is one table
// with a `kind`, the rows are identically shaped, and the only real
// difference is which endpoint the picker searches. Two near-identical
// components would drift.

const KIND_COPY: Record<UnloggedTravelKind, { title: string; singular: string; searchPlaceholder: string }> = {
  us_county: {
    title: "Counties",
    singular: "county",
    // Naming the state in the placeholder because a bare county name is
    // ambiguous — 34 different Washingtons — and the search accepts both
    // halves in either order.
    searchPlaceholder: "Search counties — try “fulton ga”…",
  },
  country: {
    title: "Countries",
    singular: "country",
    searchPlaceholder: "Search countries…",
  },
};

function formatFirstVisited(value: string | null): string {
  return value ?? "date unknown";
}

/** Search box + results, resolving what someone types to a code. */
function PickerResults({
  kind,
  onPick,
}: {
  kind: UnloggedTravelKind;
  onPick: (result: TravelSearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TravelSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  // Guards against an earlier, slower request overwriting a later one's
  // results — the classic out-of-order autocomplete bug, which is very
  // visible when a short query (many matches) races a longer one.
  const requestId = useRef(0);

  // Everything here happens inside the debounce callback rather than in
  // the effect body: a synchronous setState during an effect cascades an
  // extra render (react-hooks/set-state-in-effect), and deferring it also
  // means a fast typist never sees "Searching…" flash for a query that is
  // already superseded.
  useEffect(() => {
    const q = query.trim();
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      if (!q) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        const res = await fetch(`/api/unlogged-travel/search?kind=${kind}&q=${encodeURIComponent(q)}`);
        const body = await res.json();
        if (id !== requestId.current) return;
        setResults(Array.isArray(body) ? body : []);
      } catch {
        if (id === requestId.current) setResults([]);
      } finally {
        if (id === requestId.current) setSearching(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query, kind]);

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={KIND_COPY[kind].searchPlaceholder}
        autoFocus
      />
      {searching && results.length === 0 ? <p className="text-xs text-muted-foreground">Searching…</p> : null}
      {!searching && query.trim() && results.length === 0 ? (
        <p className="text-xs text-muted-foreground">No match. The atlas has to draw it for it to be addable.</p>
      ) : null}
      <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {results.map((r) => (
          // Keyed by code, not name: the six same-named county /
          // independent-city pairs (Richmond VA, Baltimore MD, St. Louis
          // MO…) legitimately return two rows with identical primaries,
          // and a name key would collapse them into one — which is the
          // exact ambiguity this picker exists to let a person resolve.
          <li key={r.code}>
            <button
              type="button"
              onClick={() => onPick(r)}
              className="flex w-full items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <span>{r.primary}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{r.secondary}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Add or edit one entry. Editing skips the picker — the code is the
 * identity and changing it would be a different row, not an edit. */
function EntryModal({
  kind,
  editing,
  onClose,
  onSaved,
}: {
  kind: UnloggedTravelKind;
  editing: UnloggedTravelRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Seeded once from props rather than re-synced by an effect. The caller
  // mounts this only while open and keys it by the row being edited, so a
  // different entry is a different component instance with its own fresh
  // state — which is what stops the previous entry's note showing against
  // this one's place, without a setState cascade on every open.
  const [picked, setPicked] = useState<{ code: string; label: string } | null>(
    editing ? { code: editing.code, label: editing.label ?? editing.code } : null,
  );
  const [firstVisited, setFirstVisited] = useState(editing?.firstVisited ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!picked) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/unlogged-travel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          code: picked.code,
          firstVisited: firstVisited.trim() || null,
          note: note.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Edit ${KIND_COPY[kind].singular}` : `Add ${KIND_COPY[kind].singular}`}
    >
      <div className="flex flex-col gap-3">
        {picked ? (
          <div className="flex items-baseline justify-between gap-2 rounded-md border border-border px-2 py-1.5">
            <span className="text-sm">{picked.label}</span>
            <span className="font-mono text-xs text-muted-foreground">{picked.code}</span>
            {!editing ? (
              <Button type="button" variant="ghost" size="xs" onClick={() => setPicked(null)}>
                Change
              </Button>
            ) : null}
          </div>
        ) : (
          <PickerResults kind={kind} onPick={(r) => setPicked({ code: r.code, label: r.primary })} />
        )}

        {picked ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="unlogged-first-visited">First visited</Label>
              <Input
                id="unlogged-first-visited"
                type="date"
                value={firstVisited}
                onChange={(e) => setFirstVisited(e.target.value)}
              />
              {/* Nullable on purpose — a lot of this travel predates the
                  diary. Saying so here stops an empty field reading as an
                  unfinished form. */}
              <p className="text-xs text-muted-foreground">
                Optional. Leave empty if it predates the diary or you don&apos;t remember.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unlogged-note">Note</Label>
              <Input
                id="unlogged-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. I-16 through to Savannah"
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function EntryRow({
  row,
  onEdit,
  onRemove,
}: {
  row: UnloggedTravelRow;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          {/* A code the atlas can't resolve shows as the raw code rather
              than blank — a row pointing at geometry that no longer
              exists is worth seeing, not hiding. */}
          <span className="text-sm">{row.label ?? <span className="font-mono">{row.code}</span>}</span>
          {row.label === null ? (
            <span className="text-xs text-destructive">not in the atlas</span>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">{row.detail}</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {formatFirstVisited(row.firstVisited)}
          {row.note ? ` · ${row.note}` : ""}
        </p>
        {row.loggedDays != null ? (
          // The overlap case: correct behaviour, invisible on the map, and
          // impossible to work out from the chart alone. See
          // UnloggedTravelRow.loggedDays.
          <p className="text-xs text-muted-foreground">
            Hidden on the map — {row.loggedDays} logged {row.loggedDays === 1 ? "day" : "days"} here, so it keeps its
            real colour.
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-1">
        <Button type="button" variant="ghost" size="xs" onClick={onEdit}>
          Edit
        </Button>
        <Button type="button" variant="ghost" size="xs" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </li>
  );
}

function KindSection({
  kind,
  rows,
  onChanged,
}: {
  kind: UnloggedTravelKind;
  rows: UnloggedTravelRow[];
  onChanged: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UnloggedTravelRow | null>(null);

  const remove = useCallback(
    async (row: UnloggedTravelRow) => {
      await fetch(`/api/unlogged-travel?kind=${kind}&code=${encodeURIComponent(row.code)}`, { method: "DELETE" });
      onChanged();
    },
    [kind, onChanged],
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-medium">
          {KIND_COPY[kind].title}{" "}
          <span className="font-mono text-sm text-muted-foreground">{rows.length}</span>
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
        >
          + Add {KIND_COPY[kind].singular}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing yet. Entries added here show on the maps as travelled-through.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <EntryRow
              key={row.code}
              row={row}
              onEdit={() => {
                setEditing(row);
                setModalOpen(true);
              }}
              onRemove={() => remove(row)}
            />
          ))}
        </ul>
      )}
      {modalOpen ? (
        <EntryModal
          // Keyed so switching from "add" to editing a row — or between
          // two rows — remounts with that row's own values.
          key={editing?.code ?? "new"}
          kind={kind}
          editing={editing}
          onClose={() => setModalOpen(false)}
          onSaved={onChanged}
        />
      ) : null}
    </section>
  );
}

export function UnloggedTravelManage({
  counties,
  countries,
}: {
  counties: UnloggedTravelRow[];
  countries: UnloggedTravelRow[];
}) {
  // `router.refresh()` rather than patching local state: a saved row's
  // derived fields — its atlas label, and whether logged days shadow it —
  // are computed server-side, so an optimistic patch would render a row
  // without them until the next full load. Refreshing re-runs the server
  // component and keeps the two in step, at the cost of a round trip on
  // an admin page where that is not the constraint.
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);

  return (
    <div className="flex flex-col gap-8">
      <KindSection kind="us_county" rows={counties} onChanged={refresh} />
      <KindSection kind="country" rows={countries} onChanged={refresh} />
    </div>
  );
}
