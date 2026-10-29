import { eq } from "drizzle-orm";
import { dayPortraits, days } from "@/db/schema";
import { getDb } from "@/lib/db";
import { deleteObject, presignGetObject, putObject, requirePortraitsConfig } from "@/lib/video-journal/r2";
import { portraitStorageKey, type DayPortrait, type PortraitMimeType } from "@/lib/day-portraits/rules";

// Server-only storage for day portraits (#622, #688): the image goes to the
// portraits' own private R2 bucket (`R2_PORTRAITS_BUCKET`, see
// getR2PortraitsConfig for why it is not the video bucket), and one
// `day_portraits` row per day holds its key. Never import this from a
// client component (it reaches R2 credentials).

/** An API-mappable failure: `status` is the HTTP status the route returns. */
export class PortraitError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type PortraitRow = typeof dayPortraits.$inferSelect;

async function toPortrait(row: PortraitRow): Promise<DayPortrait> {
  return {
    date: row.date,
    url: await presignGetObject(row.storageKey, requirePortraitsConfig()),
    capturedAt: row.capturedAt.toISOString(),
    sizeBytes: row.sizeBytes,
  };
}

async function findRow(date: string): Promise<PortraitRow | undefined> {
  const [row] = await getDb().select().from(dayPortraits).where(eq(dayPortraits.date, date)).limit(1);
  return row;
}

/** The day's portrait with a fresh presigned URL, or null if it has none. */
export async function getDayPortrait(date: string): Promise<DayPortrait | null> {
  const row = await findRow(date);
  return row ? toPortrait(row) : null;
}

/** Cheap presence check for the day summary card: no R2 call, no signing. */
export async function hasDayPortrait(date: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ date: dayPortraits.date })
    .from(dayPortraits)
    .where(eq(dayPortraits.date, date))
    .limit(1);
  return Boolean(row);
}

/**
 * Stores `bytes` as the day's portrait, replacing any earlier one.
 *
 * The order is deliberate: upload the new object, point the row at it, and
 * only then delete the old object. A failure at any step leaves the day
 * with a working portrait, either the old one or the new one. The worst
 * case is an orphaned object in the bucket (a failed delete, or a failed
 * database write after the upload), never a row pointing at nothing.
 */
export async function saveDayPortrait(input: {
  date: string;
  bytes: Uint8Array;
  mimeType: PortraitMimeType;
  capturedAt: Date;
}): Promise<DayPortrait> {
  const db = getDb();
  // Before any write, so an unconfigured deployment fails cleanly rather
  // than half-way through.
  const config = requirePortraitsConfig();
  const previous = await findRow(input.date);
  const storageKey = portraitStorageKey(input.date, crypto.randomUUID(), input.mimeType);

  await putObject(storageKey, input.bytes, input.mimeType, config);

  let row: PortraitRow;
  try {
    // The day row may not exist yet: a portrait can be the first thing
    // logged for a day. Bare, like the other sections' satellite saves.
    await db.insert(days).values({ date: input.date }).onConflictDoNothing({ target: days.date });
    const now = new Date();
    [row] = await db
      .insert(dayPortraits)
      .values({
        date: input.date,
        storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.bytes.byteLength,
        capturedAt: input.capturedAt,
      })
      .onConflictDoUpdate({
        target: dayPortraits.date,
        set: {
          storageKey,
          mimeType: input.mimeType,
          sizeBytes: input.bytes.byteLength,
          capturedAt: input.capturedAt,
          updatedAt: now,
        },
      })
      .returning();
  } catch (error) {
    // The row never pointed at the new object, so it is an orphan; clear it
    // best-effort and surface the real failure.
    await deleteObject(storageKey, config).catch((cleanupError: unknown) => {
      console.error("[day-portraits] Could not remove an orphaned upload:", storageKey, cleanupError);
    });
    throw error;
  }

  if (previous && previous.storageKey !== storageKey) {
    await deleteObject(previous.storageKey, config).catch((cleanupError: unknown) => {
      // The retake itself succeeded; a leftover old object is not worth
      // failing the request for.
      console.error("[day-portraits] Could not remove the replaced portrait:", previous.storageKey, cleanupError);
    });
  }

  return toPortrait(row);
}
