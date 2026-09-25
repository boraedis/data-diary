// Fallback copy the public hero at `/` renders for any `projectSettings`
// field that's unset (#452). Its own module rather than a constant in
// src/lib/project.ts because the edit form on /profile is a client
// component and shows these as placeholders. Importing them from
// project.ts would pull `getDb` into the client bundle. Keeping one copy
// means the placeholder can never disagree with what the site actually
// shows when a field is left blank.
export const PROJECT_DEFAULTS = {
  name: "Data Diary",
  tagline: "A statistical diary of one life, logged one day at a time.",
  goalsSummary:
    "Every day gets a row here — sleep, mood, work, the people and places that filled it — and this site is where the shape of that adds up over time.",
} as const;
