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
 * references — people, places, tags, place/sleep-location categories), the
 * two singleton settings rows, and a basic pass across every other domain —
 * workouts/exercises, each entertainment kind (movies, TV, books, sports,
 * games, the generic catalog), music (artists/genres/listens, including a
 * podcast show), and the profile timelines (occupations, residences,
 * relationships) plus unloggedTravel. None of these get exhaustive catalogs
 * or realistic volume — a handful of rows each, just enough that every
 * chart page has something to render rather than an empty state. If a PR
 * actually needs deeper/larger coverage of one domain, extend that section
 * here rather than reaching for real data.
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

  const insertId = async (table, columns, values) => {
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await insert(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) RETURNING id`, values);
    return rows[0]?.id ?? null;
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

  for (const name of ["Home", "Theater", "Venue"]) {
    await insert(`INSERT INTO entertainment_location_types (name) VALUES ($1)`, [name]);
  }

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

  const dates = [];
  console.log(`  ${dayCount} rows into days...`);
  for (let i = dayCount - 1; i >= 0; i--) {
    const date = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    dates.push(date);
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

  // --- Exercises / workouts ---
  console.log("  exercises, workouts...");
  const exerciseIds = {
    distance: await insertId("exercises", ["name", "category"], ["Running", "distance"]),
    sport: await insertId("exercises", ["name", "category"], ["Basketball", "sport"]),
    strength: await insertId("exercises", ["name", "category"], ["Bench Press", "strength"]),
  };
  await insertId("exercise_subtypes", ["category", "name"], ["distance", "Outdoor"]);
  await insertId("exercise_subtypes", ["category", "name"], ["strength", "Barbell"]);

  for (const date of dates) {
    if (!chance(0.3)) continue;
    const kind = pick(["distance", "sport", "strength"]);
    const workoutId = await insertId(
      "workouts",
      ["date", "exercise_id", "location_id", "duration_minutes", "distance_km", "effort"],
      [
        date,
        exerciseIds[kind],
        kind === "distance" ? null : gym.id,
        kind === "strength" ? null : randInt(20, 60),
        kind === "distance" ? Math.round(rand() * 8 * 10) / 10 : null,
        kind === "distance" ? randInt(40, 90) : null,
      ]
    );
    if (kind === "strength" && workoutId != null) {
      const setCount = randInt(2, 4);
      for (let s = 1; s <= setCount; s++) {
        await insert(`INSERT INTO workout_sets (workout_id, set_number, reps, weight_lbs) VALUES ($1, $2, $3, $4)`, [
          workoutId,
          s,
          randInt(5, 12),
          randInt(95, 225),
        ]);
      }
    }
  }

  // --- Entertainment: movies ---
  console.log("  movies...");
  const movieDefs = [
    { tmdbId: 900001, title: "The Fixture Job", release: "2022-05-12", runtime: 118, genres: ["Action", "Thriller"] },
    { tmdbId: 900002, title: "Quarterly Report", release: "2019-11-01", runtime: 102, genres: ["Comedy"] },
    { tmdbId: 900003, title: "Branch Point", release: "2024-02-20", runtime: 135, genres: ["Drama", "Sci-Fi"] },
  ];
  const movieIds = [];
  for (const m of movieDefs) {
    movieIds.push(
      await insertId(
        "movies",
        ["tmdb_id", "title", "release_date", "runtime_minutes", "genres"],
        [m.tmdbId, m.title, m.release, m.runtime, m.genres]
      )
    );
  }
  for (let i = 0; i < 6; i++) {
    await insert(
      `INSERT INTO movie_watches (movie_id, date, rating, location_type, duration_minutes) VALUES ($1, $2, $3, $4, $5)`,
      [pick(movieIds), pick(dates), randInt(5, 10), "Home", randInt(90, 140)]
    );
  }
  await insert(`INSERT INTO movie_watchlist (movie_id, added_at) VALUES ($1, $2)`, [movieIds[0], pick(dates)]);
  for (let r = 0; r < movieIds.length; r++) {
    await insert(`INSERT INTO movie_rankings (rank, movie_id) VALUES ($1, $2)`, [r + 1, movieIds[r]]);
  }

  // --- Entertainment: TV shows ---
  console.log("  tv shows...");
  const tvDefs = [
    { tmdbId: 800001, title: "Fixture Heights", genres: ["Drama"] },
    { tmdbId: 800002, title: "Branch Comedy Hour", genres: ["Comedy"] },
  ];
  const episodeIds = [];
  let tmdbEpisodeId = 700001;
  for (const t of tvDefs) {
    const showId = await insertId(
      "tv_shows",
      ["tmdb_id", "title", "genres", "status", "interested"],
      [t.tmdbId, t.title, t.genres, "Returning Series", true]
    );
    for (let ep = 1; ep <= 3; ep++) {
      episodeIds.push(
        await insertId(
          "tv_episodes",
          ["show_id", "tmdb_episode_id", "season", "episode", "name", "runtime_minutes"],
          [showId, tmdbEpisodeId++, 1, ep, `Episode ${ep}`, randInt(22, 55)]
        )
      );
    }
  }
  for (let i = 0; i < 6; i++) {
    await insert(
      `INSERT INTO tv_episode_watches (episode_id, date, location_type, duration_minutes) VALUES ($1, $2, $3, $4)`,
      [pick(episodeIds), pick(dates), "Home", randInt(20, 50)]
    );
  }

  // --- Entertainment: books ---
  console.log("  books...");
  const bookDefs = [
    { googleBooksId: "fixture-book-1", title: "The Fixture Habit", authors: ["A. Author"], pages: 240 },
    { googleBooksId: "fixture-book-2", title: "Branching Out", authors: ["B. Writer"], pages: 310 },
  ];
  const bookIds = [];
  for (const b of bookDefs) {
    bookIds.push(
      await insertId(
        "books",
        ["google_books_id", "title", "authors", "page_count"],
        [b.googleBooksId, b.title, b.authors, b.pages]
      )
    );
  }
  let lastPage = 0;
  for (let i = 0; i < 6; i++) {
    const start = lastPage;
    const end = start + randInt(10, 40);
    lastPage = end;
    await insert(
      `INSERT INTO book_reading_sessions (book_id, date, start_page, end_page, completed, location_type, duration_minutes) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [pick(bookIds), pick(dates), start, end, chance(0.2), "Home", randInt(15, 60)]
    );
  }
  await insert(`INSERT INTO book_watchlist (book_id, added_at) VALUES ($1, $2)`, [bookIds[0], pick(dates)]);
  for (let r = 0; r < bookIds.length; r++) {
    await insert(`INSERT INTO book_rankings (rank, book_id) VALUES ($1, $2)`, [r + 1, bookIds[r]]);
  }

  // --- Entertainment: sports ---
  console.log("  sports...");
  const sportId = await insertId("sports", ["name", "is_team_sport"], ["Basketball", true]);
  const leagueId = await insertId("sports_leagues", ["sport_id", "name", "type"], [sportId, "Fixture League", "Professional"]);
  const teamAId = await insertId(
    "sports_teams",
    ["sport_id", "league_id", "name", "home_location"],
    [sportId, leagueId, "Fixture City Hawks", "Fixture City"]
  );
  const teamBId = await insertId(
    "sports_teams",
    ["sport_id", "league_id", "name", "home_location"],
    [sportId, leagueId, "Branch Point Comets", "Branch Point"]
  );
  await insertId("sports_seasons", ["league_id", "name"], [leagueId, "2025-26"]);
  await insertId("sports_divisions", ["league_id", "name"], [leagueId, "Fixture Division"]);
  await insertId("sports_game_types", ["name"], ["Regular Season"]);
  for (let i = 0; i < 5; i++) {
    await insert(
      `INSERT INTO sports_watches (sport_id, league_id, season, game_type, home_team_id, away_team_id, date, watched_live, duration_minutes, location_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [sportId, leagueId, "2025-26", "Regular Season", teamAId, teamBId, pick(dates), chance(0.4), randInt(90, 180), "Home"]
    );
  }

  // --- Entertainment: games ---
  console.log("  games...");
  const gameCategoryId = await insertId("game_categories", ["name"], ["Action"]);
  await insertId("game_subcategories", ["category_id", "name"], [gameCategoryId, "Platformer"]);
  await insertId("game_device_types", ["name"], ["Console"]);
  const game1Id = await insertId("games", ["name", "type", "subtype"], ["Fixture Quest", "Action", "Platformer"]);
  const game2Id = await insertId("games", ["name", "type", "subtype"], ["Branch Runner", "Action", "Platformer"]);
  for (let i = 0; i < 5; i++) {
    await insert(
      `INSERT INTO game_sessions (game_id, date, duration_minutes, device_type, location_type) VALUES ($1,$2,$3,$4,$5)`,
      [pick([game1Id, game2Id]), pick(dates), randInt(20, 90), "Console", "Home"]
    );
  }

  // --- Entertainment: generic catalog (system kinds + one neutral kind) ---
  console.log("  entertainment_kinds/catalog...");
  for (const name of ["movie", "tvshow", "sport", "book", "game"]) {
    await insert(`INSERT INTO entertainment_kinds (name, is_system) VALUES ($1, true)`, [name]);
  }
  const concertKindId = await insertId("entertainment_kinds", ["name", "is_system"], ["Concert", false]);
  const concertCatalogId = await insertId(
    "entertainment_catalog",
    ["kind_id", "title", "detail"],
    [concertKindId, "Fixture Fest", "Outdoor amphitheater"]
  );
  for (let i = 0; i < 3; i++) {
    await insert(
      `INSERT INTO entertainment_entries (date, entertainment_id, duration_minutes, location_type, sort_order) VALUES ($1,$2,$3,$4,$5)`,
      [pick(dates), concertCatalogId, randInt(60, 180), "Venue", 0]
    );
  }

  // --- Music ---
  console.log("  music...");
  const genreGroupRockId = await insertId("genre_groups", ["name", "color"], ["Rock", "#7A5CFA"]);
  const genreGroupPopId = await insertId("genre_groups", ["name", "color"], ["Pop", "#FA5C97"]);
  const genreIndieRockId = await insertId("genres", ["name", "group_id"], ["indie rock", genreGroupRockId]);
  const genreSynthPopId = await insertId("genres", ["name", "group_id"], ["synth-pop", genreGroupPopId]);
  const genreAltId = await insertId("genres", ["name", "group_id"], ["alternative", genreGroupRockId]);

  const artistIds = [];
  for (const name of ["The Fixtures", "Branch & the Points", "Query String"]) {
    artistIds.push(await insertId("artists", ["name"], [name]));
  }
  await insert(`INSERT INTO artist_genres (artist_id, genre_id) VALUES ($1, $2)`, [artistIds[0], genreIndieRockId]);
  await insert(`INSERT INTO artist_genres (artist_id, genre_id) VALUES ($1, $2)`, [artistIds[1], genreSynthPopId]);
  await insert(`INSERT INTO artist_genres (artist_id, genre_id) VALUES ($1, $2)`, [artistIds[2], genreAltId]);

  const podcastCategoryId = await insertId("podcast_categories", ["name"], ["Technology"]);
  const podcastShowId = await insertId("podcast_shows", ["name", "category_id"], ["Fixture Weekly", podcastCategoryId]);

  const trackNames = ["Fixture Anthem", "Branch Line", "Query Loop", "Deploy Day", "Rollback Blues"];
  for (let i = 0; i < 40; i++) {
    const date = pick(dates);
    const playedAt = `${date}T${String(randInt(7, 22)).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}:00Z`;
    if (chance(0.85)) {
      await insert(
        `INSERT INTO music_listens (played_at, ms_played, track_name, artist_id, album_name) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [playedAt, randInt(90, 240) * 1000, pick(trackNames), pick(artistIds), "Fixture Sessions"]
      );
    } else {
      await insert(
        `INSERT INTO music_listens (played_at, ms_played, episode_name, podcast_show_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [playedAt, randInt(600, 3000) * 1000, `Episode ${randInt(1, 50)}`, podcastShowId]
      );
    }
  }

  // --- Profile timelines (occupations/residences/relationships) ---
  console.log("  profile timelines...");
  // "start"/"end" are reserved words in Postgres — insertId's column list is
  // interpolated as-is, so every reference to them here has to be quoted.
  const occupation1Id = await insertId(
    "profile_occupations",
    ["name", "position", "company", "place_id", '"start"', '"end"', "color"],
    ["Fixture Corp", "Software Engineer", "Fixture Corp", office.id, "2018-01-15", "2021-06-30", "#4C9AFF"]
  );
  await insert(`INSERT INTO profile_occupation_roles (occupation_id, position, "start", "end") VALUES ($1,$2,$3,$4)`, [
    occupation1Id,
    "Software Engineer",
    "2018-01-15",
    "2019-12-31",
  ]);
  await insert(`INSERT INTO profile_occupation_roles (occupation_id, position, "start", "end") VALUES ($1,$2,$3,$4)`, [
    occupation1Id,
    "Senior Software Engineer",
    "2020-01-01",
    "2021-06-30",
  ]);
  await insertId(
    "profile_occupations",
    ["name", "position", "company", "place_id", '"start"', "color"],
    ["Branch Point Inc", "Staff Engineer", "Branch Point Inc", office.id, "2021-07-01", "#36B37E"]
  );

  await insertId(
    "profile_residences",
    ["name", "place_id", '"start"', '"end"', "color"],
    ["Old Apartment", home.id, "2015-03-01", "2020-08-31", "#FFAB00"]
  );
  await insertId(
    "profile_residences",
    ["name", "place_id", '"start"', "color"],
    ["Current Place", home.id, "2020-09-01", "#00B8D9"]
  );

  await insertId(
    "profile_relationships",
    ["name", "person_id", '"start"', "color"],
    ["Ava", peopleIds[0], "2019-05-10", "#FF5630"]
  );

  // --- Unlogged travel ---
  console.log("  unlogged_travel...");
  const unloggedTravelRows = [
    ["us_county", "13121", "Fulton County, GA"],
    ["us_county", "17031", "Cook County, IL"],
    ["us_county", "06037", "Los Angeles County, CA"],
    ["us_county", "48201", "Harris County, TX"],
    ["country", "124", "Canada"],
    ["country", "484", "Mexico"],
    ["country", "250", "France"],
    ["country", "392", "Japan"],
  ];
  for (const [kind, code, note] of unloggedTravelRows) {
    await insert(`INSERT INTO unlogged_travel (kind, code, note) VALUES ($1, $2, $3)`, [kind, code, note]);
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
