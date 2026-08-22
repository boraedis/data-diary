"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DayPayload, WorkoutPayload } from "@/lib/days";

const DAY_TYPES = [
  { value: "", label: "Not set" },
  { value: "work", label: "Work" },
  { value: "dayoff", label: "Day off" },
  { value: "vacation", label: "Vacation" },
  { value: "travel", label: "Travel" },
  { value: "sick", label: "Sick" },
  { value: "jobless", label: "Jobless" },
] as const;

const WORK_LOCATIONS = ["home", "office", "cafe", "travel", "other"] as const;
const COMMUTES = ["car", "carpool", "taxi", "public_transit", "bike", "walk", "other"] as const;

function emptyWorkout(): WorkoutPayload {
  return {
    exercise: "",
    subtype: "",
    dataSource: "manual",
    location: null,
    durationMinutes: null,
    details: null,
    sets: [],
  };
}

// Numbers come off <input> elements as strings; this turns "" into null and
// anything else into a number, so form state round-trips cleanly through
// the DayPayload shape the API expects.
function parseNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function TogglePill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs capitalize transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

export function DayEntryForm({ initialDay }: { initialDay: DayPayload }) {
  const router = useRouter();
  const [day, setDay] = useState<DayPayload>(initialDay);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function set<K extends keyof DayPayload>(key: K, value: DayPayload[K]) {
    setSavedAt(null);
    setDay((prev) => ({ ...prev, [key]: value }));
  }

  function toggleWorkLocation(value: (typeof WORK_LOCATIONS)[number]) {
    setSavedAt(null);
    setDay((prev) => {
      const next = prev.workLocation.includes(value)
        ? prev.workLocation.filter((v) => v !== value)
        : [...prev.workLocation, value];
      return { ...prev, workLocation: next };
    });
  }

  function toggleCommute(value: (typeof COMMUTES)[number]) {
    setSavedAt(null);
    setDay((prev) => {
      const next = prev.commute.includes(value)
        ? prev.commute.filter((v) => v !== value)
        : [...prev.commute, value];
      return { ...prev, commute: next };
    });
  }

  function updateWorkout(index: number, patch: Partial<WorkoutPayload>) {
    setSavedAt(null);
    setDay((prev) => {
      const nextWorkouts = [...prev.workouts];
      nextWorkouts[index] = { ...nextWorkouts[index], ...patch };
      return { ...prev, workouts: nextWorkouts };
    });
  }

  function updateSet(workoutIndex: number, setIndex: number, patch: Partial<WorkoutPayload["sets"][number]>) {
    setSavedAt(null);
    setDay((prev) => {
      const nextWorkouts = [...prev.workouts];
      const workout = nextWorkouts[workoutIndex];
      const nextSets = [...workout.sets];
      nextSets[setIndex] = { ...nextSets[setIndex], ...patch };
      nextWorkouts[workoutIndex] = { ...workout, sets: nextSets };
      return { ...prev, workouts: nextWorkouts };
    });
  }

  function addWorkout() {
    setSavedAt(null);
    setDay((prev) => ({ ...prev, workouts: [...prev.workouts, emptyWorkout()] }));
  }

  function removeWorkout(index: number) {
    setSavedAt(null);
    setDay((prev) => ({
      ...prev,
      workouts: prev.workouts.filter((_, i) => i !== index),
    }));
  }

  function addSet(workoutIndex: number) {
    setSavedAt(null);
    setDay((prev) => {
      const nextWorkouts = [...prev.workouts];
      const workout = nextWorkouts[workoutIndex];
      nextWorkouts[workoutIndex] = {
        ...workout,
        sets: [
          ...workout.sets,
          { setNumber: workout.sets.length + 1, reps: null, weightLbs: null, durationSeconds: null },
        ],
      };
      return { ...prev, workouts: nextWorkouts };
    });
  }

  function removeSet(workoutIndex: number, setIndex: number) {
    setSavedAt(null);
    setDay((prev) => {
      const nextWorkouts = [...prev.workouts];
      const workout = nextWorkouts[workoutIndex];
      nextWorkouts[workoutIndex] = {
        ...workout,
        sets: workout.sets
          .filter((_, i) => i !== setIndex)
          .map((s, i) => ({ ...s, setNumber: i + 1 })),
      };
      return { ...prev, workouts: nextWorkouts };
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/days/${day.date}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(day),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }

      setDay(body as DayPayload);
      setSavedAt(Date.now());
      router.refresh();
    } catch {
      setError("Network error — could not save");
    } finally {
      setSaving(false);
    }
  }

  const awayFromHome = day.workLocation.some((loc) => loc !== "home");

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 pb-20">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Health</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="distanceWalked">Distance walked (km)</Label>
            <Input
              id="distanceWalked"
              type="number"
              step="0.01"
              min="0"
              value={day.distanceWalkedKm ?? ""}
              onChange={(e) => set("distanceWalkedKm", parseNumber(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="coffees">Coffees</Label>
            <Input
              id="coffees"
              type="number"
              step="1"
              min="0"
              value={day.coffees ?? ""}
              onChange={(e) => set("coffees", parseNumber(e.target.value))}
            />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="sick">Sick</Label>
            <Select
              id="sick"
              value={day.sick === null ? "" : day.sick ? "yes" : "no"}
              onChange={(e) => set("sick", e.target.value === "" ? null : e.target.value === "yes")}
            >
              <option value="">Not recorded</option>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Sleep</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="sleepTime">Sleep time</Label>
            <Input
              id="sleepTime"
              type="time"
              value={day.sleepTime ?? ""}
              onChange={(e) => set("sleepTime", e.target.value || null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wakeTime">Wake time</Label>
            <Input
              id="wakeTime"
              type="time"
              value={day.wakeTime ?? ""}
              onChange={(e) => set("wakeTime", e.target.value || null)}
            />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 rounded border-input accent-primary"
              checked={day.wakeCrossedMidnight}
              onChange={(e) => set("wakeCrossedMidnight", e.target.checked)}
            />
            Woke up the day after I fell asleep
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="sleepLocationType">Sleep location</Label>
            <Input
              id="sleepLocationType"
              placeholder="e.g. home"
              value={day.sleepLocationType ?? ""}
              onChange={(e) => set("sleepLocationType", e.target.value || null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sleepLocationSubtype">Sleep location detail</Label>
            <Input
              id="sleepLocationSubtype"
              placeholder="e.g. own bed"
              value={day.sleepLocationSubtype ?? ""}
              onChange={(e) => set("sleepLocationSubtype", e.target.value || null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="napMinutes">Naps (minutes)</Label>
            <Input
              id="napMinutes"
              type="number"
              step="1"
              min="0"
              value={day.napMinutes ?? ""}
              onChange={(e) => set("napMinutes", parseNumber(e.target.value))}
            />
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Happiness</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="happiness">Happiness</Label>
              <span className="font-mono text-sm text-muted-foreground">
                {day.happiness ?? "—"}%
              </span>
            </div>
            <input
              id="happiness"
              type="range"
              min={0}
              max={100}
              step={1}
              value={day.happiness ?? 50}
              onChange={(e) => set("happiness", Number(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Input
              id="reason"
              value={day.happinessReason ?? ""}
              onChange={(e) => set("happinessReason", e.target.value || null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="journal">Journal</Label>
            <Textarea
              id="journal"
              rows={4}
              value={day.journal ?? ""}
              onChange={(e) => set("journal", e.target.value || null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dayType">Day type</Label>
            <Select
              id="dayType"
              value={day.dayType ?? ""}
              onChange={(e) => set("dayType", (e.target.value || null) as DayPayload["dayType"])}
            >
              {DAY_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Work</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="productivity">Productivity</Label>
              <span className="font-mono text-sm text-muted-foreground">
                {day.productivity ?? "—"}%
              </span>
            </div>
            <input
              id="productivity"
              type="range"
              min={0}
              max={100}
              step={1}
              value={day.productivity ?? 50}
              onChange={(e) => set("productivity", Number(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="workDurationMinutes">Work duration (minutes)</Label>
            <Input
              id="workDurationMinutes"
              type="number"
              step="1"
              min="0"
              value={day.workDurationMinutes ?? ""}
              onChange={(e) => set("workDurationMinutes", parseNumber(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Work location</Label>
            <div className="flex flex-wrap gap-2">
              {WORK_LOCATIONS.map((loc) => (
                <TogglePill key={loc} active={day.workLocation.includes(loc)} onClick={() => toggleWorkLocation(loc)}>
                  {loc.replace("_", " ")}
                </TogglePill>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Commute{awayFromHome ? " (required)" : ""}</Label>
            <div className="flex flex-wrap gap-2">
              {COMMUTES.map((c) => (
                <TogglePill key={c} active={day.commute.includes(c)} onClick={() => toggleCommute(c)}>
                  {c.replace("_", " ")}
                </TogglePill>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Workouts</CardTitle>
          <CardDescription>
            {day.workouts.length === 0 ? "None logged yet." : `${day.workouts.length} logged.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {day.workouts.map((workout, wi) => (
            <div key={wi} className="rounded-lg border border-border p-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`exercise-${wi}`}>Exercise</Label>
                  <Input
                    id={`exercise-${wi}`}
                    value={workout.exercise}
                    onChange={(e) => updateWorkout(wi, { exercise: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`subtype-${wi}`}>Subtype</Label>
                  <Input
                    id={`subtype-${wi}`}
                    value={workout.subtype}
                    onChange={(e) => updateWorkout(wi, { subtype: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`location-${wi}`}>Location</Label>
                  <Input
                    id={`location-${wi}`}
                    value={workout.location ?? ""}
                    onChange={(e) => updateWorkout(wi, { location: e.target.value || null })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`duration-${wi}`}>Duration (minutes)</Label>
                  <Input
                    id={`duration-${wi}`}
                    type="number"
                    step="1"
                    min="0"
                    value={workout.durationMinutes ?? ""}
                    onChange={(e) => updateWorkout(wi, { durationMinutes: parseNumber(e.target.value) })}
                  />
                </div>
              </div>

              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Sets</Label>
                  <Button type="button" variant="ghost" size="xs" onClick={() => addSet(wi)}>
                    + Add set
                  </Button>
                </div>
                {workout.sets.map((workoutSet, si) => (
                  <div key={si} className="flex items-center gap-2">
                    <span className="w-5 shrink-0 font-mono text-xs text-muted-foreground">
                      {workoutSet.setNumber}
                    </span>
                    <Input
                      type="number"
                      placeholder="reps"
                      aria-label="Reps"
                      value={workoutSet.reps ?? ""}
                      onChange={(e) => updateSet(wi, si, { reps: parseNumber(e.target.value) })}
                    />
                    <Input
                      type="number"
                      step="0.5"
                      placeholder="lbs"
                      aria-label="Weight in pounds"
                      value={workoutSet.weightLbs ?? ""}
                      onChange={(e) => updateSet(wi, si, { weightLbs: parseNumber(e.target.value) })}
                    />
                    <Input
                      type="number"
                      placeholder="seconds"
                      aria-label="Duration in seconds"
                      value={workoutSet.durationSeconds ?? ""}
                      onChange={(e) => updateSet(wi, si, { durationSeconds: parseNumber(e.target.value) })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Remove set"
                      onClick={() => removeSet(wi, si)}
                    >
                      &times;
                    </Button>
                  </div>
                ))}
              </div>

              <Button type="button" variant="destructive" size="xs" className="mt-3" onClick={() => removeWorkout(wi)}>
                Remove workout
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={addWorkout}>
            + Add workout
          </Button>
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 py-3">
          <span className="text-sm">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : savedAt ? (
              <span className="text-muted-foreground">Saved.</span>
            ) : null}
          </span>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}
