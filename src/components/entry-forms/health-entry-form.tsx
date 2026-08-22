"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DayPayload, HealthPayload, WorkoutPayload } from "@/lib/days";

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

function parseNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function HealthEntryForm({ date, initial }: { date: string; initial: HealthPayload }) {
  const router = useRouter();
  const [health, setHealth] = useState<HealthPayload>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function set<K extends keyof HealthPayload>(key: K, value: HealthPayload[K]) {
    setSavedAt(null);
    setHealth((prev) => ({ ...prev, [key]: value }));
  }

  function updateWorkout(index: number, patch: Partial<WorkoutPayload>) {
    setSavedAt(null);
    setHealth((prev) => {
      const nextWorkouts = [...prev.workouts];
      nextWorkouts[index] = { ...nextWorkouts[index], ...patch };
      return { ...prev, workouts: nextWorkouts };
    });
  }

  function updateSet(
    workoutIndex: number,
    setIndex: number,
    patch: Partial<WorkoutPayload["sets"][number]>
  ) {
    setSavedAt(null);
    setHealth((prev) => {
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
    setHealth((prev) => ({ ...prev, workouts: [...prev.workouts, emptyWorkout()] }));
  }

  function removeWorkout(index: number) {
    setSavedAt(null);
    setHealth((prev) => ({
      ...prev,
      workouts: prev.workouts.filter((_, i) => i !== index),
    }));
  }

  function addSet(workoutIndex: number) {
    setSavedAt(null);
    setHealth((prev) => {
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
    setHealth((prev) => {
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
      const res = await fetch(`/api/days/${date}/health`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(health),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }

      const saved = body as DayPayload;
      setHealth({
        distanceWalkedKm: saved.distanceWalkedKm,
        coffees: saved.coffees,
        sick: saved.sick,
        workouts: saved.workouts,
      });
      setSavedAt(Date.now());
      router.refresh();
    } catch {
      setError("Network error — could not save");
    } finally {
      setSaving(false);
    }
  }

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
              value={health.distanceWalkedKm ?? ""}
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
              value={health.coffees ?? ""}
              onChange={(e) => set("coffees", parseNumber(e.target.value))}
            />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="sick">Sick</Label>
            <Select
              id="sick"
              value={health.sick === null ? "" : health.sick ? "yes" : "no"}
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
          <CardTitle>Workouts</CardTitle>
          <CardDescription>
            {health.workouts.length === 0 ? "None logged yet." : `${health.workouts.length} logged.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {health.workouts.map((workout, wi) => (
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

              <Button
                type="button"
                variant="destructive"
                size="xs"
                className="mt-3"
                onClick={() => removeWorkout(wi)}
              >
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
