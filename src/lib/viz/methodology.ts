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

export const INSTAGRAM_METHODOLOGY =
  "Follower and following counts are logged straight from the Instagram app, tracking how both have grown or shrunk over time.";

export const PLACES_METHODOLOGY =
  "Each day, I pick the two places that had the biggest impact on it — not necessarily where I spent the most time, but usually wherever the day's main activity happened. The first slot counts double toward totals, the second counts once. Every place sits in a hierarchy, typically country, then state or province, then municipality, then neighborhood for larger cities, then a specific location, and sometimes a sub-location for a room or unit within a building — so time can be drilled down from an entire country to a single room.";

export const CITY_HEATMAP_METHODOLOGY =
  "For the cities I've spent significant time in — Istanbul, Dubai, Atlanta, DC, and NYC — I've mapped out neighborhood boundaries by hand, letting the same daily place logs show which neighborhoods I actually frequented in each one.";

export const PEOPLE_METHODOLOGY =
  "Each day, I pick up to seven people, in order, who impacted me the most that day — the same ranked-slot idea as places. Every person is also tagged with a label for how I know them (family, a friend group, work, and so on). There are also three rarely-used slots for people who had a notably negative impact on a day, but across the whole history that's only ever been used a handful of times.";

export const PEOPLE_IMPACT_METHODOLOGY =
  "This score isn't a simple day count — it combines which of the seven ranked slots a person occupied with how that day was rated for happiness, using a scoring formula carried over unchanged from the original version of this app. Presence counts for more on a day's best or hardest moments than on an unremarkable one, since that's when someone's presence tends to actually matter.";

export const LIFE_METHODOLOGY =
  "This tracks the start and end of engagements in three areas of my life: occupation (any job or educational engagement), residence (a living situation that was my primary home at the time), and relationship (a romantic engagement). An occupation can also carry its own roles — promotions or title changes within the same job, logged separately so a raise doesn't read as starting a whole new career.";

export const DAY_TYPE_METHODOLOGY =
  "Every day is classified into one of six categories: Work (any day with significant work on my occupation, school included), Day off (not working and not traveling — a weekend or holiday spent at home), Vacation (away from home on some kind of trip), Travel (a day spent primarily getting somewhere, like a full day of flights, trains, or driving), Sick (a day significantly affected by being unwell), and Jobless (a day off during a stretch of unemployment, distinct from an ordinary day off).";
