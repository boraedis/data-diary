"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SavedColorItem = { id: number; hex: string; name: string | null };

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Drop-in replacement for a raw hex text input or native
 * `<input type="color">` (issue #45) — every "set this item's color" form
 * field in this app (a tag, a place, a sports team, a genre group, a
 * profile timeline entry) used one of those two directly before this.
 * Adds a shared, Manage-page-editable "saved colors" list (see
 * /manage/colors and src/lib/catalog-admin.ts's SavedColor functions) to
 * pick from — deliberately NOT a foreign key, picking a saved color just
 * copies its hex into `value` exactly like typing it by hand would. The
 * "+" button saves whatever's currently in the field to that shared list
 * in one click, no separate trip to Manage required.
 *
 * Fetches its own palette on mount rather than taking it as a prop — with
 * 6 real call sites across 6 different pages, threading a server-fetched
 * list + an onCreated callback down to each one would be more plumbing
 * than the feature is worth. Deliberately NOT used for the tight inline
 * per-row recolor swatches in genre-catalog-panel.tsx and
 * colors-manage-panel.tsx itself — a full picker+palette+save UI doesn't
 * fit in a compact list row, and those exist specifically for a quick
 * recolor without opening anything bigger.
 *
 * `value`/`onChange` stay a plain hex string (or "" for unset), matching
 * every existing consumer's own state shape — this only swaps the input
 * element, not the surrounding null-on-submit conversion each caller
 * already does. */
export function ColorInput({
  id,
  value,
  onChange,
  className,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [savedColors, setSavedColors] = useState<SavedColorItem[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/colors")
      .then((res) => (res.ok ? res.json() : []))
      .then((items) => {
        if (!cancelled) setSavedColors(items as SavedColorItem[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const canSave = HEX_PATTERN.test(value) && !savedColors.some((c) => c.hex.toLowerCase() === value.toLowerCase());

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await fetch("/api/colors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hex: value }),
      });
      if (res.ok) {
        const created = (await res.json()) as SavedColorItem;
        setSavedColors((prev) => [...prev, created]);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#64748b"
          className="flex-1 font-mono"
        />
        <input
          type="color"
          aria-label="Pick a color"
          value={HEX_PATTERN.test(value) ? value : "#64748b"}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-10 shrink-0 cursor-pointer rounded-lg border border-input bg-transparent p-0"
        />
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          aria-label="Save this color to the shared list"
          title="Save this color to the shared list"
          disabled={!canSave || saving}
          onClick={handleSave}
        >
          +
        </Button>
      </div>
      {savedColors.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {savedColors.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c.hex)}
              title={c.name ?? c.hex}
              aria-label={c.name ?? c.hex}
              className={cn(
                "size-6 shrink-0 rounded-full border-2 transition-transform hover:scale-110",
                value.toLowerCase() === c.hex.toLowerCase() ? "border-foreground" : "border-border"
              )}
              style={{ backgroundColor: c.hex }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
