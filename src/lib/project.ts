// Admin CRUD for project-level settings backing the public landing page
// (#12/#82) — see the schema comment on `projectSettings` for why this is
// separate from profileSettings. Same "validate -> query -> return" shape
// as every other settings/domain lib in this codebase (see the owner-
// identity section of src/lib/profile.ts).
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { projectSettings } from "@/db/schema";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type ProjectSettingsItem = {
  name: string | null;
  tagline: string | null;
  goalsSummary: string | null;
};

export function validateProjectSettingsInput(body: unknown): Result<ProjectSettingsItem> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" && b.name.trim() ? b.name.trim() : null;
  const tagline = typeof b.tagline === "string" && b.tagline.trim() ? b.tagline.trim() : null;
  const goalsSummary =
    typeof b.goalsSummary === "string" && b.goalsSummary.trim() ? b.goalsSummary.trim() : null;
  return { ok: true, value: { name, tagline, goalsSummary } };
}

// Row id=1 either exists (from a prior save) or doesn't yet — every field
// defaults to null rather than the caller needing to special-case "no
// settings saved yet" as an error.
export async function getProjectSettings(): Promise<ProjectSettingsItem> {
  const db = getDb();
  const [row] = await db
    .select({
      name: projectSettings.name,
      tagline: projectSettings.tagline,
      goalsSummary: projectSettings.goalsSummary,
    })
    .from(projectSettings)
    .where(eq(projectSettings.id, 1));
  return row ?? { name: null, tagline: null, goalsSummary: null };
}

export async function upsertProjectSettings(input: ProjectSettingsItem): Promise<ProjectSettingsItem> {
  const db = getDb();
  const [row] = await db
    .insert(projectSettings)
    .values({ id: 1, ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: projectSettings.id,
      set: { ...input, updatedAt: new Date() },
    })
    .returning({
      name: projectSettings.name,
      tagline: projectSettings.tagline,
      goalsSummary: projectSettings.goalsSummary,
    });
  return row;
}
