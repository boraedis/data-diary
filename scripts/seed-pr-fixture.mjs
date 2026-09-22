/**
 * Wipes whatever data a freshly-created PR database branch inherited from
 * its parent (copy-on-write from `production` — see pr-db-branch-create.yml)
 * and replaces it with a small, deterministic, entirely made-up fixture
 * dataset instead.
 *
 * Why: issue #376 stopped publishing PR branch connection strings in a
 * public PR comment, since this repo is public. That closed the "leaked
 * credential" hole, but every PR branch was still a full copy-on-write copy
 * of real production data (locations, relationships, journal text) sitting
 * behind whatever access the branch's credentials get — more copies of
 * sensitive data than a schema-testing branch actually needs. This script
 * removes that: nothing a PR branch serves after this runs is real.
 *
 * What it seeds: the day-entry domain (`days` plus the catalogs it
 * references — people, places, tags, place/sleep-location categories) and
 * the two singleton settings rows. That's the one table every chart-page
 * category except `life` reads from (see AGENTS.md), so this covers the
 * bulk of what a PR actually needs to click around and verify. Deliberately
 * NOT seeded: entertainment (movies/TV/books/games/sports/podcasts/music),
 * workouts/exercises, profile occupations/residences/relationships
 * (life-timeline), unloggedTravel. Charts fed by those stay empty on a PR
 * branch — add fixture rows for one here if a PR actually needs to exercise
 * it; don't feel obligated to cover all of them up front.
 *
 * Safety: this TRUNCATEs every table in the `public` schema before
 * inserting, so it must never run anywhere but a disposable PR branch.
 * Dry-run by default (prints what it would wipe/insert); `--commit` to
 * actually write. Also hard-refuses (no prompt — this needs to be safe
 * non-interactively in CI) if DATABASE_URL's host is listed in
 * PROD_DB_HOSTS.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/seed-pr-fixture.mjs --commit
 */
import pg from "pg";

const COMMIT = process.argv.includes("--commit");

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL to the Postgres connection string to seed.");
  process.exit(1);
}

function resolveHost(databaseUrl) {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return null;
  }
}

function refuseIfProd() {
  const prodHosts = (process.env.PROD_DB_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (prodHosts.length === 0) return;
  const host = resolveHost(process.env.DATABASE_URL);
  if (host && prodHosts.includes(host)) {
    console.error(
      `Refusing to run: DATABASE_URL's host (${host}) is listed in PROD_DB_HOSTS. This script TRUNCATEs every table — it must only ever run against a disposable PR database branch.`
    );
    process.exit(1);
  }
}

// Deterministic PRNG (mulberry32) so a fixture reseed produces the same
// shape of data every time, rather than a different random dataset per CI
// run that's harder to reason about while testing a PR.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260376);
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = (arr) => arr[randInt(0, arr.length - 1)];
const chance = (p) => rand() < p;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function wipeAllTables(client) {
  const { rows } = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  );
  const tableNames = rows.map((r) => `"${r.tablename}"`);
  if (tableNames.length === 0) {
    console.log("No tables found in the public schema — nothing to wipe.");
    return;
  }
  console.log(`Wiping ${tableNames.length} table(s): ${rows.map((r) => r.tablename).join(", ")}`);
  if (COMMIT) {
    await client.query(`TRUNCATE TABLE ${tableNames.join(", ")} RESTART IDENTITY CASCADE`);
  }
}

const PEOPLE = [
  { name: "Ava Martinez", tag: "Family" },
  { name: "Sofia Rossi", tag: "Family" },
  { name: "Liam Chen", tag: "Friend" },
  { name: "Noah Johnson", tag: "Friend" },
  { name: "Maya Patel", tag: "Colleague" },
  { name: "Ethan Brooks", tag: "Colleague" },
];

const HAPPINESS_REASONS = [
  "Good workout this morning",
  "Caught up with an old friend",
  "Rough commute",
  "Great dinner out",
  "Productive day at work",
  "Slept badly, felt it all day",
  null,
  null,
];

async function seedFixture(client) {
  console.log(COMMIT ? "Inserting fixture data..." : "Would insert fixture data (pass --commit to write):");

  const insert = async (text, params) => {
    console.log(`  ${text.split("\n")[0].trim()}...`);
    if (!COMMIT) return { rows: [] };
    return client.query(text, params);
  };

  await insert(
    `INSERT INTO profile_settings (id, name, birthdate, diary_start_date) VALUES (1, 'Fixture User', '1990-06-15', $1)`,
    [new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)]
  );
  await insert(
    `INSERT INTO project_settings (id, name, tagline, goals_summary) VALUES (1, 'Data Diary (PR fixture)', 'A fixture dataset for testing', 'Seeded fixture data for this PR branch — not real diary data.')`
  );

  const tagIds = {};
  for (const tagName of ["Family", "Friend", "Colleague"]) {
    const { rows } = await insert(`INSERT INTO tags (name) VALUES ($1) RETURNING id`, [tagName]);
    tagIds[tagName] = rows[0]?.id ?? null;
  }

  const peopleIds = [];
  for (const p of PEOPLE) {
    const { rows } = await insert(`INSERT INTO people (name, tag_id) VALUES ($1, $2) RETURNING id`, [
      p.name,
      tagIds[p.tag],
    ]);
    peopleIds.push(rows[0]?.id ?? null);
  }

  const placeCategoryIds = {};
  for (const name of ["Home", "Work", "Leisure"]) {
    const { rows } = await insert(`INSERT INTO place_categories (name) VALUES ($1) RETURNING id`, [name]);
    placeCategoryIds[name] = rows[0]?.id ?? null;
  }
  for (const [category, sub] of [
    ["Home", "Apartment"],
    ["Work", "Office"],
    ["Leisure", "Restaurant"],
    ["Leisure", "Gym"],
  ]) {
    await insert(`INSERT INTO place_subcategories (category_id, name) VALUES ($1, $2)`, [
      placeCategoryIds[category],
      sub,
    ]);
  }

  const { rows: metroRows } = await insert(`INSERT INTO metros (name, country) VALUES ($1, $2) RETURNING id`, [
    "Fixture Metro",
    "Fixtureland",
  ]);
  const metroId = metroRows[0]?.id ?? null;

  const insertPlace = async (name, parentId, category, subcategory, placeMetroId, parentIdPath, parentNamePath) => {
    const { rows } = await insert(
      `INSERT INTO places (name, parent_id, category, subcategory, metro_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name, parentId, category ?? null, subcategory ?? null, placeMetroId ?? null]
    );
    const id = rows[0]?.id ?? null;
    const idPath = `${parentIdPath}${id}/`;
    const namePath = `${parentNamePath}${name}/`;
    if (COMMIT && id != null) {
      await client.query(`UPDATE places SET id_path = $1, name_path = $2 WHERE id = $3`, [idPath, namePath, id]);
    }
    return { id, idPath, namePath };
  };

  const country = await insertPlace("Fixtureland", null, null, null, null, "", "");
  const city = await insertPlace("Fixture City", country.id, null, null, metroId, country.idPath, country.namePath);
  const home = await insertPlace("Home Apartment", city.id, "Home", "Apartment", null, city.idPath, city.namePath);
  const office = await insertPlace("Office", city.id, "Work", "Office", null, city.idPath, city.namePath);
  const diner = await insertPlace("Downtown Diner", city.id, "Leisure", "Restaurant", null, city.idPath, city.namePath);
  const gym = await insertPlace("City Gym", city.id, "Leisure", "Gym", null, city.idPath, city.namePath);
  const placeIds = [home.id, office.id, diner.id, gym.id];

  const { rows: sleepTypeRows } = await insert(`INSERT INTO sleep_location_types (name) VALUES ($1) RETURNING id`, [
    "Home",
  ]);
  await insert(`INSERT INTO sleep_location_subtypes (type_id, name) VALUES ($1, $2)`, [
    sleepTypeRows[0]?.id ?? null,
    "Own bed",
  ]);
  await insert(`INSERT INTO sleep_location_subtypes (type_id, name) VALUES ($1, $2)`, [
    sleepTypeRows[0]?.id ?? null,
    "Guest room",
  ]);

  // --- days: 90 consecutive days ending yesterday ---
  const dayCount = 90;
  const today = new Date();
  let weight = 74;
  let followers = 480;
  let following = 210;

  const dayColumns = [
    "date",
    "distance_walked_km",
    "coffees",
    "sick",
    "sleep_time",
    "wake_time",
    "wake_crossed_midnight",
    "sleep_location_type",
    "sleep_location_subtype",
    "nap_minutes",
    "happiness",
    "happiness_reason",
    "journal",
    "day_type",
    "productivity",
    "work_duration_minutes",
    "work_location",
    "commute",
    "phone_usage_minutes",
    "laptop_usage_minutes",
    "instagram_usage_minutes",
    "weight_kg",
    "body_fat_percent",
    "muscle_mass_kg",
    "instagram_followers",
    "instagram_following",
    "positive_person_1_id",
    "positive_person_2_id",
    "positive_person_3_id",
    "negative_person_1_id",
    "place_1_id",
    "place_2_id",
    "sub_a",
    "sub_w",
    "sub_c",
    "sub_l",
    "sub_ni",
    "sub_no",
    "sub_ad",
    "sub_d",
    "sub_k",
  ];

  console.log(`  ${dayCount} rows into days...`);
  for (let i = dayCount - 1; i >= 0; i--) {
    const date = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    const dow = new Date(date).getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    const dayType = isWeekend ? (chance(0.2) ? "vacation" : "dayoff") : "work";

    weight += (rand() - 0.5) * 0.3;
    followers += randInt(0, 2);
    following += chance(0.1) ? 1 : 0;

    const sleepHour = randInt(22, 23);
    const wakeHour = randInt(6, 8);
    const positiveSlots = [null, null, null];
    const positiveCount = randInt(0, 3);
    for (let s = 0; s < positiveCount; s++) positiveSlots[s] = pick(peopleIds);

    const values = [
      date,
      Math.round(rand() * 8 * 10) / 10,
      randInt(0, 4),
      chance(0.03),
      `${String(sleepHour).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}`,
      `${String(wakeHour).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}`,
      true,
      "Home",
      "Own bed",
      chance(0.15) ? randInt(15, 45) : null,
      randInt(35, 95),
      pick(HAPPINESS_REASONS),
      chance(0.3) ? "Fixture journal entry." : null,
      dayType,
      dayType === "work" ? randInt(30, 95) : null,
      dayType === "work" ? randInt(300, 540) : null,
      dayType === "work" ? [pick(["home", "office"])] : null,
      dayType === "work" ? [pick(["car", "public_transit", "walk", "bike"])] : null,
      randInt(60, 240),
      randInt(60, 300),
      randInt(0, 60),
      Math.round(weight * 10) / 10,
      Math.round((16 + rand() * 8) * 10) / 10,
      Math.round((55 + rand() * 4) * 10) / 10,
      followers,
      following,
      positiveSlots[0],
      positiveSlots[1],
      positiveSlots[2],
      chance(0.08) ? pick(peopleIds) : null,
      chance(0.5) ? pick(placeIds) : null,
      chance(0.25) ? pick(placeIds) : null,
      chance(0.6) ? randInt(0, 10) : null,
      chance(0.6) ? randInt(0, 10) : null,
      chance(0.6) ? randInt(0, 10) : null,
      chance(0.6) ? randInt(0, 10) : null,
      chance(0.6) ? randInt(0, 10) : null,
      chance(0.6) ? randInt(0, 10) : null,
      chance(0.6) ? randInt(0, 10) : null,
      chance(0.6) ? randInt(0, 10) : null,
      chance(0.6) ? randInt(0, 10) : null,
    ];

    if (COMMIT) {
      const placeholders = dayColumns.map((_, idx) => `$${idx + 1}`).join(", ");
      await client.query(`INSERT INTO days (${dayColumns.join(", ")}) VALUES (${placeholders})`, values);
    }
  }
}

async function main() {
  refuseIfProd();
  const client = await pool.connect();
  try {
    await wipeAllTables(client);
    await seedFixture(client);
    console.log(COMMIT ? "\nDone." : "\nDry run only — nothing was written. Re-run with --commit to write.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
