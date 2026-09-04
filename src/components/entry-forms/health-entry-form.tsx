"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DurationInput } from "@/components/ui/duration-input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CatalogPicker } from "@/components/entry-forms/catalog-picker";
import { ExercisePicker, type ExerciseCatalogItem } from "@/components/entry-forms/exercise-picker";
import type {
  DayPayload,
  HealthPayload,
  PlaceCatalogItem,
  WorkoutPayload,
  WorkoutSetPayload,
} from "@/lib/days";
import type { WorkoutDataSource } from "@/db/schema";

type WorkoutDraft = {
  exerciseId: number | null;
  locationId: number | null;
  subtype: string | null;
  dataSource: WorkoutDataSource;
  durationMinutes: number | null;
  distanceKm: number | null;
  effort: number | null;
  sets: WorkoutSetPayload[];
};

function emptyWorkout(): WorkoutDraft {
  return {
    exerciseId: null,
    locationId: null,
    subtype: null,
    dataSource: "manual",
    durationMinutes: null,
    distanceKm: null,
    effort: null,
    sets: [],
  };
}

function toDrafts(workouts: WorkoutPayload[]): WorkoutDraft[] {
  return workouts.map((w) => ({
    exerciseId: w.exerciseId,
    locationId: w.locationId,
    subtype: w.subtype,
    dataSource: w.dataSource,
    durationMinutes: w.durationMinutes,
    distanceKm: w.distanceKm,
    effort: w.effort,
    sets: w.sets,
  }));
}

function parseNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function HealthEntryForm({
  date,
  initial,
  exerciseCatalog,
  placeCatalog,
}: {
  date: string;
  initial: HealthPayload;
  exerciseCatalog: ExerciseCatalogItem[];
  placeCatalog: PlaceCatalogItem[];
}) {
  const router = useRouter();
  const [health, setHealth] = useState<{
    distanceWalkedKm: number | null;
    coffees: number | null;
    sick: boolean | null;
  }>({
    distanceWalkedKm: initial.distanceWalkedKm,
    coffees: initial.coffees,
    sick: initial.sick,
  });
  const [workouts, setWorkouts] = useState<WorkoutDraft[]>(() => toDrafts(initial.workouts));
  const [exercises, setExercises] = useState<ExerciseCatalogItem[]>(exerciseCatalog);
  const [places, setPlaces] = useState<PlaceCatalogItem[]>(placeCatalog);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function set<K extends keyof typeof health>(key: K, value: (typeof health)[K]) {
    setSavedAt(null);
    setHealth((prev) => ({ ...prev, [key]: value }));
  }

  function updateWorkout(index: number, patch: Partial<WorkoutDraft>) {
    setSavedAt(null);
    setWorkouts((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  function updateSet(workoutIndex: number, setIndex: number, patch: Partial<WorkoutSetPayload>) {
    setSavedAt(null);
    setWorkouts((prev) => {
      const next = [...prev];
      const workout = next[workoutIndex];
      const nextSets = [...workout.sets];
      nextSets[setIndex] = { ...nextSets[setIndex], ...patch };
      next[workoutIndex] = { ...workout, sets: nextSets };
      return next;
    });
  }

  function addWorkout() {
    setSavedAt(null);
    setWorkouts((prev) => [...prev, emptyWorkout()]);
  }

  function removeWorkout(index: number) {
    setSavedAt(null);
    setWorkouts((prev) => prev.filter((_, i) => i !== index));
  }

  function addSet(workoutIndex: number) {
    setSavedAt(null);
    setWorkouts((prev) => {
      const next = [...prev];
      const workout = next[workoutIndex];
      next[workoutIndex] = {
        ...workout,
        sets: [
          ...workout.sets,
          { setNumber: workout.sets.length + 1, reps: null, weightLbs: null, durationSeconds: null },
        ],
      };
      return next;
    });
  }

  function removeSet(workoutIndex: number, setIndex: number) {
    setSavedAt(null);
    setWorkouts((prev) => {
      const next = [...prev];
      const workout = next[workoutIndex];
      next[workoutIndex] = {
        ...workout,
        sets: workout.sets
          .filter((_, i) => i !== setIndex)
          .map((s, i) => ({ ...s, setNumber: i + 1 })),
      };
      return next;
    });
  }

  function handleExerciseCreated(item: ExerciseCatalogItem) {
    setExercises((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)));
  }

  function handlePlaceCreated(item: PlaceCatalogItem) {
    setPlaces((prev) => [...prev, item]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (workouts.some((w) => w.exerciseId === null)) {
      setError("Every workout needs an exercise selected");
      return;
    }

    setSaving(true);

    const payload: HealthPayload = {
      ...health,
      workouts: workouts.map((w) => ({
        exerciseId: w.exerciseId as number,
        locationId: w.locationId,
        subtype: w.subtype,
        dataSource: w.dataSource,
        durationMinutes: w.durationMinutes,
        distanceKm: w.distanceKm,
        effort: w.effort,
        sets: w.sets,
      })),
    };

    try {
      const res = await fetch(`/api/days/${date}/health`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
      });
      setWorkouts(toDrafts(saved.workouts));
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
        <CardContent className="flex flex-col gap-4 md:grid md:grid-cols-2 md:gap-6">
          <div className="space-y-1.5">
            <Label htmlFor="distanceWalked">Distance walked (km)</Label>
            <Input
              id="distanceWalked"
              type="number"
              step="0.01"
              min="0"
              value={health.distanceWalkedKm ?? ""}
              onChange={(e) => set("distanceWalkedKm", parseNumber(e.target.value))}
              autoFocus
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
            {workouts.length === 0 ? "None logged yet." : `${workouts.length} logged.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {workouts.map((workout, wi) => {
            const exercise = exercises.find((e) => e.id === workout.exerciseId);
            const category = exercise?.category ?? null;

            return (
              <div key={wi} className="rounded-lg border border-border p-4">
                <div className="flex flex-col gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor={`exercise-${wi}`}>Exercise</Label>
                    <ExercisePicker
                      id={`exercise-${wi}`}
                      items={exercises}
                      valueId={workout.exerciseId}
                      onChange={(id) => updateWorkout(wi, { exerciseId: id, locationId: null })}
                      onCreated={handleExerciseCreated}
                      autoFocus={workout.exerciseId === null}
                    />
                  </div>

                  {category ? (
                    <div className="space-y-1.5">
                      <Label htmlFor={`subtype-${wi}`}>Variant</Label>
                      <Input
                        id={`subtype-${wi}`}
                        placeholder="e.g. Barbell, Dumbbell, Machine"
                        value={workout.subtype ?? ""}
                        onChange={(e) =>
                          updateWorkout(wi, { subtype: e.target.value.trim() === "" ? null : e.target.value })
                        }
                      />
                    </div>
                  ) : null}

                  {category ? (
                    <div className="space-y-1.5">
                      <Label htmlFor={`location-${wi}`}>Location</Label>
                      {/* Workout location is the same places catalog day-level
                          places uses (not a category-scoped catalog — see the
                          comment above the `exercises` table in schema.ts). */}
                      <CatalogPicker
                        id={`location-${wi}`}
                        itemLabel="Place"
                        items={places}
                        valueId={workout.locationId}
                        onChange={(id) => updateWorkout(wi, { locationId: id })}
                        onCreated={handlePlaceCreated}
                        createApiPath="/api/places"
                        addLabel="New place"
                      />
                    </div>
                  ) : null}

                  {category === "distance" ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor={`duration-${wi}-hours`}>Time</Label>
                        <DurationInput
                          id={`duration-${wi}`}
                          totalMinutes={workout.durationMinutes}
                          onChange={(v) => updateWorkout(wi, { durationMinutes: v })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`distance-${wi}`}>Distance (km)</Label>
                        <Input
                          id={`distance-${wi}`}
                          type="number"
                          step="0.01"
                          min="0"
                          value={workout.distanceKm ?? ""}
                          onChange={(e) => updateWorkout(wi, { distanceKm: parseNumber(e.target.value) })}
                        />
                      </div>
                      <div className="col-span-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label htmlFor={`effort-${wi}`}>Effort</Label>
                          <span className="font-mono text-sm text-muted-foreground">
                            {workout.effort ?? "—"}%
                          </span>
                        </div>
                        <input
                          id={`effort-${wi}`}
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={workout.effort ?? 50}
                          onChange={(e) => updateWorkout(wi, { effort: Number(e.target.value) })}
                          className="w-full accent-primary"
                        />
                      </div>
                    </div>
                  ) : null}

                  {category === "sport" ? (
                    <div className="space-y-1.5">
                      <Label htmlFor={`duration-${wi}-hours`}>Duration</Label>
                      <DurationInput
                        id={`duration-${wi}`}
                        totalMinutes={workout.durationMinutes}
                        onChange={(v) => updateWorkout(wi, { durationMinutes: v })}
                      />
                    </div>
                  ) : null}

                  {category === "strength" ? (
                    <div className="space-y-2">
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
                            onChange={(e) =>
                              updateSet(wi, si, { durationSeconds: parseNumber(e.target.value) })
                            }
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
                  ) : null}
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
            );
          })}
          <Button type="button" variant="outline" onClick={addWorkout}>
            + Add workout
          </Button>
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-3 md:max-w-2xl">
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
