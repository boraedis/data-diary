/**
 * Per-field methodology copy for the `ChartInfo` popup's "Methodology"
 * section (#316, the content follow-up to #315's chart-page shell rework).
 *
 * One constant per *underlying field*, not per chart — every chart built
 * on the same logged field (e.g. every happiness chart) shares the exact
 * same methodology, since the methodology question is "what does this
 * number actually mean," which doesn't change with how a given chart
 * slices or buckets it. Written in first person: this is the app owner
 * explaining their own data-entry habits, not a generic product
 * description.
 */

export const HAPPINESS_METHODOLOGY =
  "Happiness is self-rated on a 0–100% scale, logged once a day to capture how the day felt overall. It's inherently subjective, but a decade of consistent tracking has given the number a fairly calibrated sense of my own baseline. I like to think of myself as a generally happy person who also tries to stay mindful of the everyday privileges I have, so most \"normal\" days land somewhere around 80–90%, with lower scores reserved for days that were genuinely harder than usual.";

export const SLEEP_METHODOLOGY =
  "Sleep duration comes from a sleep time and a wake time logged for each day. How those two times get captured has changed over the years — for a long stretch they were entered manually from memory, more recently they come from a sleep-tracking app, where \"sleep time\" is when I fell asleep and \"wake time\" is when I stopped the app's tracking, a close but imperfect proxy for the moment I actually woke up.";

export const SLEEP_HOURS_METHODOLOGY = `${SLEEP_METHODOLOGY} Each night is placed on the day it ends, so a bar dated the 25th runs from the evening of the 24th into the morning of the 25th, and the tooltip leads with the day you woke up. Its colour is that wake day's type — a work night is the sleep before a work day; nights before day types were tracked (2019) are drawn in grey as not recorded. The clock axis runs from noon to noon rather than midnight to midnight, which keeps a night that crosses midnight in one piece; the wake time is the sleep time plus that night's duration, the same figure every other sleep chart uses. Over a long stretch the clock axis is fitted to all but the most unusual 1% of bedtimes and wake times, so a stray entry (a daytime sleep, a near-20-hour night) is cut off at the chart's edge rather than squeezing every normal night into a sliver — hover it for its real times.`;

export const SLEEP_LOCATION_METHODOLOGY =
  "Where I slept each night is logged in two parts. The location is a general category — home, a friend's place, family's house, at a partner's, or even a tent while camping. The sub-location is what I actually slept on or in: a bed, a couch, an air mattress, or, while traveling, the mode of transit itself — a flight, bus, train, or car.";

export const COFFEE_METHODOLOGY =
  "Coffee is logged as a simple count of cups per day. It's not a precise measure — cup size and strength vary quite a bit from one to the next — but it's consistent enough to track the ebb and flow of caffeine intake over time.";

export const DISTANCE_METHODOLOGY =
  "Distance walked comes from my iPhone's own tracking, logged once per day. It has the usual limitations of phone-based tracking — a day with the phone left behind or spent walking indoors can undercount — but it's a consistent enough source to see real patterns over time.";

export const WEIGHT_METHODOLOGY =
  "Weight is logged as often as I remember to step on the scale — there's no fixed schedule, so gaps and clusters in the data reflect how consistent I was at the time, not anything about my weight itself. It's a digital scale that also estimates body fat % and muscle mass alongside the weight reading, using whatever method the scale itself uses — those two are rougher estimates than the weight number itself.";

export const TRAINING_METHODOLOGY =
  "Every workout is logged here, whether that's a structured gym session, a sport, or a casual jog. Most of it comes from an app I already track things in — Strava for cardio, Hevy for lifting — copied or imported over, but anything more casual, like playing volleyball in the park with friends, gets logged directly.";

export const SCREEN_TIME_METHODOLOGY =
  "Phone and laptop usage come from each device's own built-in screen-time tracking, logged as minutes per day. Instagram usage is tracked the same way, added more recently once I wanted to actively watch and limit it specifically — it's a slice of phone time, not a separate total on top of it.";

export const SUBS_METHODOLOGY =
  "Each sub is logged once a day as a 0–10 intensity score, 0 meaning none that day. A sub left blank on a day counts as not logged rather than as zero, so it's skipped in averages instead of pulling them down. Nine subs are tracked; most days only a few of them are ever above zero.";

export const INSTAGRAM_METHODOLOGY =
  "Follower and following counts are logged straight from the Instagram app, tracking how both have grown or shrunk over time.";

export const PLACES_METHODOLOGY =
  "Each day, I pick the two places that had the biggest impact on it — not necessarily where I spent the most time, but usually wherever the day's main activity happened. The first slot counts double toward totals, the second counts once. Every place sits in a hierarchy, typically country, then state or province, then municipality, then neighborhood for larger cities, then a specific location, and sometimes a sub-location for a room or unit within a building — so time can be drilled down from an entire country to a single room.";

/** The Centre of Gravity map (#215). The method was reviewed on that issue
 * before it was built — see src/lib/location-centre.ts for the full
 * reasoning. */
export const LOCATION_CENTRE_METHODOLOGY =
  "Each day gets one vote, shared between the places it logs: half each when both have coordinates, all of it when only one does. A place without its own coordinates borrows its nearest parent's, but never a state's or a country's, since those are the middle of the map rather than anywhere I've been; a day that can only be placed that roughly isn't counted, and the coverage figure above the map says how many were. The line is a rolling centre of mass: for each point, the average position of the days in the window of years ending on it, worked out on the globe rather than on a flat map, so it's right across the date line and near the poles. Being an average, it's meant to sit between places when my days were split between them: three months away in a one-year window pulls it about a quarter of the way to where I went. Because the window looks back, a move bends the line gradually over the following window rather than all at once, and the latest point is simply where my last few years were centred. In my first years of logging there isn't a full window of history behind a point yet, so it averages what there is, and its breakdown says so. A window needs a quarter of its days located to get a point. The circles are the areas being averaged: a place's metro area where I've set one, otherwise its municipality, each drawn at the middle of all its days and sized by its share of the years shown. A point's tooltip splits the days in its window between those areas. Unlogged travel isn't counted (passing through isn't living there), and neither are workout locations, which would count gym days twice.";

export const CITY_HEATMAP_METHODOLOGY =
  "For the cities I've spent significant time in — Istanbul, Dubai, Atlanta, DC, and NYC — I've mapped out neighborhood boundaries by hand, letting the same daily place logs show which neighborhoods I actually frequented in each one. A place is credited to the neighborhood its catalog entry names, not to wherever its coordinates fall, so a wrong coordinate shows only as a misplaced dot; the \"Check places\" button lists every place where the two disagree. The water around them (sea, rivers, and lakes) is drawn only for orientation, from OpenStreetMap data (© OpenStreetMap contributors, via Overture Maps).";

export const PEOPLE_METHODOLOGY =
  "Each day, I pick up to seven people, in order, who impacted me the most that day — the same ranked-slot idea as places. Every person is also tagged with a label for how I know them (family, a friend group, work, and so on). There are also three rarely-used slots for people who had a notably negative impact on a day, but across the whole history that's only ever been used a handful of times.";

/** The network's own statistics on top of the shared people logging
 * paragraph — see src/lib/people-network.ts's header for the longer
 * reasoning behind each choice. */
export const PEOPLE_NETWORK_METHODOLOGY = `${PEOPLE_METHODOLOGY} For the network, a line between two people isn't just "logged on the same day a few times": it's drawn only when they show up together more often than they would if each were logged independently at their own rate (a hypergeometric test per pair, corrected for testing tens of thousands of pairs at once — a 1% false-discovery rate by default, a stricter Bonferroni bar for "Strong", 5% for "Loose"), and they share at least three days. Line thickness is the overlap between the two: shared days divided by the geometric mean of each person's total, so a pair seen together on nearly all of their days reads as strongly tied whether that's 20 days or 800. The test is run over the history up to the month shown, so scrubbing back asks who was close as of then.`;

/** The treemap's counting rule on top of the shared people paragraph —
 * see src/lib/people-treemap.ts. */
export const PEOPLE_TREEMAP_METHODOLOGY = `${PEOPLE_METHODOLOGY} Each tile is one person, sized by one of two things as of the month shown (the whole history, unless the time-lapse is parked earlier). Days is the number of days they've been logged — a running count, as legacy's version was, where someone in two slots on the same day counts once. Impact is the People Race's and the People Leaderboard's score: each scored day counts by that day's happiness and the slot they were in, faded the longer before the month shown it was — so under Impact a tile shrinks again once someone drifts out of my days, where under Days it only ever grows. Days with no happiness score count toward Days but carry no impact. Only the seven positive slots count, the same as the other people charts — the rarely-used negative ones are left out. Grouped by tag, each tag is a panel in its own colour; a tag without one gets a palette colour picked over the whole history, so it never changes as the time-lapse plays.`;

export const PEOPLE_IMPACT_METHODOLOGY =
  "This score isn't a simple day count — it combines which of the seven ranked slots a person occupied with how that day was rated for happiness, using a scoring formula carried over unchanged from the original version of this app. Presence counts for more on a day's best or hardest moments than on an unremarkable one, since that's when someone's presence tends to actually matter.";

/** The trend's own reading on top of the impact score: the recency
 * weighting and the per-period averaging. See src/lib/people-impact-trend.ts. */
export const PEOPLE_IMPACT_TREND_METHODOLOGY = `${PEOPLE_IMPACT_METHODOLOGY} Each line is a running standing rather than a tally, plotted for every day with no averaging: on any given day, a person's standing adds up every score they've ever earned, with older days counting for less — they hold close to full weight for the first few months, fade most steeply around a year, and settle at a small floor rather than disappearing. So a line climbs while someone is in my days and eases back down over a year or two once they're not. The first five months of the log are left off, while every standing is still climbing from zero. "Top 30" is ranked over the whole history (by average standing, or by days logged), and picking a group adds the people in it logged at least 15 times; anyone else can be added by name. The time range only changes which dates are in view — it never changes who's shown.`;

export const LIFE_METHODOLOGY =
  "This tracks the start and end of engagements in three areas of my life: occupation (any job or educational engagement), residence (a living situation that was my primary home at the time), and relationship (a romantic engagement). An occupation can also carry its own roles — promotions or title changes within the same job, logged separately so a raise doesn't read as starting a whole new career.";

export const DAY_TYPE_METHODOLOGY =
  "Every day is classified into one of six categories: Work (any day with significant work on my occupation, school included), Day off (not working and not traveling — a weekend or holiday spent at home), Vacation (away from home on some kind of trip), Travel (a day spent primarily getting somewhere, like a full day of flights, trains, or driving), Sick (a day significantly affected by being unwell), and Jobless (a day off during a stretch of unemployment, distinct from an ordinary day off).";

// The Work charts (#444). Deliberately limited to what the data itself
// shows — how the fields relate and when they start — rather than claims
// about entry habits; the owner's own first-person detail can replace it.

export const WORK_METHODOLOGY =
  "Each work day logs the time I spent working and a self-rated productivity score from 0–100%. Productive hours multiply the two, so an 8-hour day at 50% and a focused 4-hour day at 100% both come out at 4 productive hours. Averages only count the days that logged the measure being shown, so a day off never counts as zero hours. Hours and productivity have only been logged since May 2026; which days were work days goes back further, on the Day Types calendar.";

export const WORK_LOCATION_METHODOLOGY =
  "Each work day records where I worked (home, the office, a cafe, while travelling or somewhere else) and how I got there. A day can have more than one of each, so a morning at home and an afternoon in the office is logged as both. A day that records a location but no commute is counted as no commute, which is how days working from home are logged.";

export const WORK_HAPPINESS_METHODOLOGY =
  "Pairs each day's happiness score with its work log. Each row is the average happiness of the days in that group. The whiskers are a 95% confidence interval for that average: wide when a group has few days, narrow when it has many. n is the number of days in the group. The dotted line is the average across every day in the comparison. Days missing what a grouping needs (no hours logged, say) are left out of that grouping rather than shown as unknown. These are associations, not causes: a long day and a low score can share a reason, like a deadline.";

export const JOB_METHODOLOGY =
  "Every day marked as a work day is credited to the jobs active on that date in my occupation history. School counts as a job here, the same way it does for day types. Where two overlapped (a co-op during university, say), the day counts toward both. Hours come from the time-worked log, which starts in May 2026, so the hours measure only covers jobs held since then.";

// The leaderboards added in #115. Same voice as the rest: what's recorded
// and how, not how the chart is drawn.

export const MUSIC_METHODOLOGY =
  "Every stream comes from Spotify's extended streaming history export, imported in bulk rather than logged by hand. Each artist is matched to one catalog entry however Spotify spells it, and carries the genres Spotify assigns it, which are hand-sorted into a small set of genre groups. Time is what Spotify recorded as played, so a skipped track counts only for the seconds it ran.";

export const PODCAST_METHODOLOGY =
  "Podcast episodes come from the same Spotify streaming history export as music. Each show is matched to one catalog entry and filed under a hand-picked category, since Spotify doesn't publish a podcast taxonomy. Time is what Spotify recorded as played.";

export const ENTERTAINMENT_METHODOLOGY =
  "Entertainment is logged per session: each movie watched, TV episode, reading session, sports game and gaming session, plus anything else (concerts, theatre) under its own kind. Each session records how long it took and where it happened. Movies and TV are matched to TMDB, books to Google Books; sports are logged by league and teams.";

export const SPORTS_METHODOLOGY =
  "Every game watched is logged with its sport, league, the two teams playing and how long I watched. Conferences are the ones each team belongs to in the catalog — ACC, NFC North, Eastern and so on.";

export const TV_BACKLOG_METHODOLOGY =
  "An episode counts as backlog from the day it aired, or the day I started watching its show if that was later, until I watched it. A show is one I follow from its first logged watch until I dropped it, so the day I start a long-running show, every episode already aired and not yet seen joins the backlog at once. A show I dropped stops counting on the day I marked it uninterested, or, where that wasn't recorded, on the day of its last logged watch. Episodes watched before I began tracking and episodes with no air date are left out, and episodes yet to air aren't counted. Each day shows the backlog as it stood that day, split by show.";

export const MUSIC_RACE_METHODOLOGY = `${MUSIC_METHODOLOGY} Each frame is one month, ranking artists by listening time. Cumulative adds up everything heard so far, so it only ever grows and, a decade in, the early leaders rarely get caught. Recent fades each past month the longer ago it was — the same fade the People Race uses, about half weight a year back and a small floor beyond — so artists I've stopped playing fall away and rank changes keep happening; its figure is weighted hours, not real ones. Bars are coloured by the artist's top genre (their genre with the most listening overall), for the five genres I've listened to most; every other genre, and artists with none, share the grey. Podcasts aren't included, and months follow UTC.`;

export const RANKING_RIBBON_METHODOLOGY =
  "I keep a top-10 list of my favourite films and of my favourite books, and every time I change one, the change is logged: what came in, what dropped out, what moved. This chart replays that log to show the list as it stood at the end of each year, and as it stands now for the current one. The log only started once I began recording changes, so there's nothing before that: the chart opens on the year that began and the first column is simply the list as I first recorded it. A year in which I didn't touch the list repeats the year before.";
