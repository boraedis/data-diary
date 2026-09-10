"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { DurationInput } from "@/components/ui/duration-input";
import { CatalogPicker } from "@/components/entry-forms/catalog-picker";
import type { ExerciseCatalogItem } from "@/components/entry-forms/exercise-picker";
import type { PlaceCatalogItem } from "@/lib/days";
import { parseHevyImport, type HevyParsedWorkout } from "@/lib/hevy-import";

/**
 * "Import from Hevy" — pastes Hevy's shareable workout text and turns it
 * into workout drafts for the currently-open day (issue #229). Deliberately
 * a plain modal over the health entry form's own draft state rather than a
 * separate import page/API route (unlike the music importer): the target
 * day is already fixed by the page you're on, and the exercise catalog the
 * parser matches against is already loaded client-side, so there's nothing
 * a server round-trip would buy here.
 */
export function HevyImportModal({
  open,
  onClose,
  openDayDate,
  exerciseCatalog,
  placeCatalog,
  onPlaceCreated,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  openDayDate: string;
  exerciseCatalog: ExerciseCatalogItem[];
  placeCatalog: PlaceCatalogItem[];
  onPlaceCreated: (item: PlaceCatalogItem) => void;
  onImport: (workouts: HevyParsedWorkout[], locationId: number | null) => void;
}) {
  const [text, setText] = useState("");
  const [locationId, setLocationId] = useState<number | null>(null);
  const [sessionTotalMinutes, setSessionTotalMinutes] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dateWarning, setDateWarning] = useState<string | null>(null);

  function reset() {
    setText("");
    setLocationId(null);
    setSessionTotalMinutes(null);
    setErrors([]);
    setDateWarning(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleImport() {
    if (!text.trim()) {
      setErrors(["Paste some Hevy workout text first"]);
      return;
    }
    // Required, not optional (see issue #229's own open question, and #228):
    // leaving it blank was legacy's quirk that produced non-timed workouts
    // with no duration at all, which is exactly what #228 found. Import is
    // the one place this can be prevented outright, so it's enforced here.
    if (sessionTotalMinutes === null) {
      setErrors(["Session total duration is required"]);
      return;
    }
    const result = parseHevyImport(text, exerciseCatalog, {
      locationId,
      sessionTotalMinutes,
      openDayDate,
    });
    if (!result.ok) {
      setErrors(result.errors);
      setDateWarning(null);
      return;
    }
    onImport(result.workouts, locationId);
    if (result.dateWarning) {
      // Leave the modal open so the warning is visible rather than silently
      // closing over a likely wrong-day paste (issue #229).
      setDateWarning(result.dateWarning);
      setErrors([]);
      setText("");
      return;
    }
    reset();
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Import from Hevy">
      <div className="flex flex-col gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="hevy-text">Pasted workout text</Label>
          <Textarea
            id="hevy-text"
            rows={10}
            placeholder={"Push Day\nTue, Mar 28, 2023 ...\n\nBicep Curl (Dumbbell)\nSet 1: 10 reps"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="hevy-location">Location (applies to every workout in this paste)</Label>
          <CatalogPicker
            id="hevy-location"
            itemLabel="Place"
            items={placeCatalog}
            valueId={locationId}
            onChange={setLocationId}
            onCreated={onPlaceCreated}
            createApiPath="/api/places"
            addLabel="New place"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="hevy-duration">Session total duration</Label>
          <DurationInput
            id="hevy-duration"
            totalMinutes={sessionTotalMinutes}
            onChange={setSessionTotalMinutes}
          />
        </div>

        {dateWarning ? <p className="text-sm text-amber-600 dark:text-amber-400">{dateWarning}</p> : null}

        {errors.length > 0 ? (
          <ul className="space-y-1 text-sm text-destructive">
            {errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={handleClose}>
            Close
          </Button>
          <Button type="button" onClick={handleImport} disabled={!text.trim() || sessionTotalMinutes === null}>
            Import
          </Button>
        </div>
      </div>
    </Modal>
  );
}
