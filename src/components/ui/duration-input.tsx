"use client";

import { Input } from "@/components/ui/input";

function parseNonNegativeInt(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

/**
 * Paired hours+minutes inputs for any field stored as a single "total
 * minutes" integer (technology usage, work duration, naps, workout/
 * entertainment length, ...). Typing raw minutes for anything over an hour
 * is annoying to do in your head, so this splits entry into h/m and
 * recombines on change; the stored value underneath is still one number.
 */
export function DurationInput({
  id,
  totalMinutes,
  onChange,
}: {
  id: string;
  totalMinutes: number | null;
  onChange: (totalMinutes: number | null) => void;
}) {
  const hours = totalMinutes !== null ? Math.floor(totalMinutes / 60) : null;
  const minutes = totalMinutes !== null ? totalMinutes % 60 : null;

  function update(nextHours: number | null, nextMinutes: number | null) {
    if (nextHours === null && nextMinutes === null) {
      onChange(null);
      return;
    }
    onChange((nextHours ?? 0) * 60 + (nextMinutes ?? 0));
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        id={`${id}-hours`}
        type="number"
        step="1"
        min="0"
        placeholder="0"
        aria-label="Hours"
        className="w-20"
        value={hours ?? ""}
        onChange={(e) => update(parseNonNegativeInt(e.target.value), minutes)}
      />
      <span className="text-base text-muted-foreground">h</span>
      <Input
        id={`${id}-minutes`}
        type="number"
        step="1"
        min="0"
        max="59"
        placeholder="0"
        aria-label="Minutes"
        className="w-20"
        value={minutes ?? ""}
        onChange={(e) => {
          const parsed = parseNonNegativeInt(e.target.value);
          update(hours, parsed !== null ? Math.min(parsed, 59) : null);
        }}
      />
      <span className="text-base text-muted-foreground">m</span>
    </div>
  );
}
