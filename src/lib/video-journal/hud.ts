// The mission HUD (#599, epic #338): the Martian-vlog-style readout framing
// the camera while recording, and redrawn over the video on playback.
// Pure types and formatting only, shared by the browser and the server.
//
// Decisions (owner, #599 and #338's 2026-10-08 comment):
// - The HUD is an overlay, never burned into the video file. The stored
//   file is the plain camera video; a "burn it in" export may come later.
// - Split sources. Conditions that can't change afterwards (time,
//   timezone, location, weather) are captured once when recording starts
//   and stored with the recording (video_logs.hud_snapshot). Diary stats
//   (sleep, coffees, distance walked, happiness) are read live for that
//   date at playback, so things logged later in the day still show up.
// - Stats not logged yet are hidden, not shown as blanks.
// - No "SOL" count, no compass, no streak.
// - Look: mission terminal (monospace, uppercase, corner brackets).

/** Where the device actually was when recording started: its live GPS
 * fix, reverse-geocoded from those coordinates. Never taken from the
 * diary's saved places (owner's call on #599). */
export type HudLocation = {
  lat: number;
  lng: number;
  /** Reported accuracy radius, in metres. */
  accuracyM: number | null;
  /** From reverse geocoding; null when it failed or isn't configured. */
  city: string | null;
  /** State/province ("NY"). Stored, but not shown: the owner chose City,
   * Country for the HUD (#599). */
  region: string | null;
  /** ISO 3166 alpha-2 ("US"). */
  country: string | null;
  /** Full country name ("United States"), what the HUD shows. */
  countryName: string | null;
};

export type HudWeather = {
  tempC: number;
  /** WMO weather code, as Open-Meteo reports it. */
  code: number;
  windKph: number;
  isDay: boolean;
};

/** Stored with each recording. Every part is optional except the time: a
 * denied location permission or a failed lookup just leaves that part out,
 * and recording never waits on any of it. */
export type HudSnapshot = {
  /** ISO timestamp when recording started (device clock). */
  capturedAt: string;
  /** Device IANA timezone. */
  timeZone: string | null;
  location: HudLocation | null;
  weather: HudWeather | null;
};

/** The day's live diary numbers (read at playback, #599's split). */
export type HudDiaryStats = {
  sleepTime: string | null;
  wakeTime: string | null;
  wakeCrossedMidnight: boolean;
  coffees: number | null;
  distanceWalkedKm: number | null;
  happiness: number | null;
};

/** WMO weather interpretation codes (the set Open-Meteo returns), as short
 * uppercase HUD labels. */
const WMO: Record<number, string> = {
  0: "CLEAR",
  1: "MAINLY CLEAR",
  2: "PARTLY CLOUDY",
  3: "OVERCAST",
  45: "FOG",
  48: "RIME FOG",
  51: "LIGHT DRIZZLE",
  53: "DRIZZLE",
  55: "HEAVY DRIZZLE",
  56: "FREEZING DRIZZLE",
  57: "FREEZING DRIZZLE",
  61: "LIGHT RAIN",
  63: "RAIN",
  65: "HEAVY RAIN",
  66: "FREEZING RAIN",
  67: "FREEZING RAIN",
  71: "LIGHT SNOW",
  73: "SNOW",
  75: "HEAVY SNOW",
  77: "SNOW GRAINS",
  80: "RAIN SHOWERS",
  81: "RAIN SHOWERS",
  82: "HEAVY SHOWERS",
  85: "SNOW SHOWERS",
  86: "HEAVY SNOW SHOWERS",
  95: "THUNDERSTORM",
  96: "THUNDERSTORM, HAIL",
  99: "THUNDERSTORM, HAIL",
};

export function weatherLabel(code: number): string {
  return WMO[code] ?? "WEATHER";
}

/** "18°C PARTLY CLOUDY". Wind isn't shown (owner's call on #599); it's
 * still captured in the snapshot in case that changes. */
export function formatWeather(w: HudWeather): string {
  return `${Math.round(w.tempC)}°C ${weatherLabel(w.code)}`;
}

/** "40.7128°N 74.0060°W": four decimals is ~11m, finer than a phone's fix. */
export function formatCoords(lat: number, lng: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}°${ns} ${Math.abs(lng).toFixed(4)}°${ew}`;
}

/**
 * Country names as the HUD and journal header show them (owner's call on
 * #599): the common short form for countries whose full name is long
 * ("United States" → "USA"), and the plain name for everything else
 * ("Czechia", "France"). Keyed by ISO code, so it doesn't depend on the
 * geocoder's exact spelling. Turkey is listed because Google now returns
 * "Türkiye", and the owner wants "Turkey". Applied at display time only;
 * the stored snapshot keeps the geocoder's full name, so this list can
 * change without rewriting old recordings.
 */
const COUNTRY_DISPLAY: Record<string, string> = {
  US: "USA",
  GB: "UK",
  AE: "UAE",
  TR: "Turkey",
};

export function countryDisplayName(code: string | null, name: string | null): string | null {
  if (code && COUNTRY_DISPLAY[code.toUpperCase()]) return COUNTRY_DISPLAY[code.toUpperCase()];
  return name ?? code;
}

/** "New York, USA": City, Country (owner's call on #599). Falls back to
 * whichever half is known, or null. */
export function formatPlace(loc: HudLocation): string | null {
  const country = countryDisplayName(loc.country, loc.countryName);
  if (!loc.city) return country ?? null;
  return country ? `${loc.city}, ${country}` : loc.city;
}

function hhmmToMinutes(hhmm: string): number | null {
  const [h, m] = hhmm.split(":").map((x) => Number.parseInt(x, 10));
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

/** "SLEEP 7H 20M · UP 7:05". Same duration rule as the sleep charts
 * (src/lib/charts.ts getSleepNightsData): wake minus sleep, plus a day when
 * waking crossed midnight, and nothing for implausible values. */
export function formatSleep(stats: Pick<HudDiaryStats, "sleepTime" | "wakeTime" | "wakeCrossedMidnight">): string | null {
  if (!stats.sleepTime || !stats.wakeTime) return null;
  const sleep = hhmmToMinutes(stats.sleepTime);
  const wake = hhmmToMinutes(stats.wakeTime);
  if (sleep === null || wake === null) return null;
  const minutes = wake - sleep + (stats.wakeCrossedMidnight ? 24 * 60 : 0);
  if (minutes <= 0 || minutes > 20 * 60) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const up = `${Math.floor(wake / 60)}:${String(wake % 60).padStart(2, "0")}`;
  return `SLEEP ${h}H ${String(m).padStart(2, "0")}M · UP ${up}`;
}

/** The stats lines that have something to say, in a fixed order. Missing
 * values are dropped rather than rendered as "—" (#599). */
export function diaryStatLines(stats: HudDiaryStats | null): string[] {
  if (!stats) return [];
  const lines: string[] = [];
  const sleep = formatSleep(stats);
  if (sleep) lines.push(sleep);
  const intake: string[] = [];
  if (stats.coffees !== null) intake.push(`COFFEE ${stats.coffees}`);
  if (stats.distanceWalkedKm !== null) intake.push(`WALKED ${stats.distanceWalkedKm.toFixed(1)} KM`);
  if (intake.length) lines.push(intake.join(" · "));
  if (stats.happiness !== null) lines.push(`HAPPINESS ${stats.happiness}`);
  return lines;
}

/** "THU 8 OCT 2026 · 21:47:05 EDT" in the recording's timezone (UTC when
 * unknown). 24-hour, like a mission clock. */
export function formatHudClock(at: Date, timeZone: string | null): string {
  const format = (tz: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "short",
    }).formatToParts(at);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")} · ${get("hour")}:${get("minute")}:${get("second")} ${get("timeZoneName")}`.toUpperCase();
  };
  if (timeZone) {
    try {
      return format(timeZone);
    } catch {
      // Unknown zone: fall through to UTC.
    }
  }
  return format("UTC");
}

// --- Validation of a snapshot sent by a device -----------------------------

const MAX_TEXT = 120;

function num(v: unknown, min: number, max: number): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() && v.length <= MAX_TEXT ? v.trim() : null;
}

/**
 * Accepts what a device sent as its HUD snapshot, keeping only well-formed
 * parts. Never rejects the upload over it: a garbled location just isn't
 * stored. Returns null if there's nothing usable at all.
 */
export function sanitizeHudSnapshot(input: unknown): HudSnapshot | null {
  if (typeof input !== "object" || input === null) return null;
  const s = input as Record<string, unknown>;
  const capturedAt = typeof s.capturedAt === "string" && !Number.isNaN(Date.parse(s.capturedAt)) ? s.capturedAt : null;
  if (!capturedAt) return null;

  let location: HudLocation | null = null;
  if (typeof s.location === "object" && s.location !== null) {
    const l = s.location as Record<string, unknown>;
    const lat = num(l.lat, -90, 90);
    const lng = num(l.lng, -180, 180);
    if (lat !== null && lng !== null) {
      location = {
        lat,
        lng,
        accuracyM: num(l.accuracyM, 0, 1_000_000),
        city: text(l.city),
        region: text(l.region),
        country: text(l.country),
        countryName: text(l.countryName),
      };
    }
  }

  let weather: HudWeather | null = null;
  if (typeof s.weather === "object" && s.weather !== null) {
    const w = s.weather as Record<string, unknown>;
    const tempC = num(w.tempC, -100, 70);
    const code = num(w.code, 0, 99);
    const windKph = num(w.windKph, 0, 500);
    if (tempC !== null && code !== null && windKph !== null) {
      weather = { tempC, code, windKph, isDay: w.isDay === true };
    }
  }

  return {
    capturedAt: new Date(capturedAt).toISOString(),
    timeZone: text(s.timeZone),
    location,
    weather,
  };
}
