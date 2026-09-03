"use client";

import { Input } from "@/components/ui/input";

function parseValue(value: string, step: number | null): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  if (step === null) {
    return Number.isFinite(n) ? Math.max(0, n) : null;
  } else {
    return Number.isFinite(n) ? Math.max(0, step ? Math.round(n / step) * step : Math.round(n)) : null;
  }
}

/**
 * Paired hours+minutes inputs for any field stored as a single "total
 * minutes" integer (technology usage, work duration, naps, workout/
 * entertainment length, ...). Typing raw minutes for anything over an hour
 * is annoying to do in your head, so this splits entry into h/m and
 * recombines on change; the stored value underneath is still one number.
 */
export function PercentInput({
  id,
  value,
  onChange,
  step = null
}: {
  id: string;
  value: number | null;
  onChange: (value: number | null) => void;
  step?: number | null;
}) {

  function update(nextValue: number | null) {
    if (nextValue === null) {
      onChange(null);
      return;
    }
    onChange(nextValue);
  }

  return (
    <Input
      id={id}
      type="number"
      min="0"
      max="100"
      placeholder="0"
      aria-label="%"
      value={value ?? ""}
      step={step ?? "any"}
      onChange={(e) => update(parseValue(e.target.value, step))}
    />
  );
}
