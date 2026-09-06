import { ChartCard } from "@/components/charts/chart-card";
import { PlaceLeaderboard } from "@/components/charts/place-leaderboard";
import { WorldVisitsChart } from "@/components/charts/world-visits-chart";
import { RecapStatCard } from "@/components/recap/recap-stat-card";
import { MIN_DAYS_FOR_TOTAL, toRecapStat } from "@/lib/recap";
import type { RecapCount, RecapDiscovery, RecapPeoplePlaces } from "@/lib/recap-people-places";

// The people & places section of the recap report (issue #172, epic #130).
//
// Both charts here are the existing chart pages' own components, handed
// period-scoped data instead of all-time data — `PlaceLeaderboard`
// (InteractiveRanked, #22) and `WorldVisitsChart` (InteractiveGeo, #24).
// That's deliberate per #172: no bespoke recap chart components, and it
// means the map keeps the app-standard `h-[min(62vh,640px)] min-h-[320px]`
// container that lives inside `WorldVisitsChart` rather than this section
// picking its own height.

export function RecapPeoplePlacesSection({
  data,
  periodLabel,
  priorLabel,
}: {
  data: RecapPeoplePlaces;
  periodLabel: string;
  priorLabel: string;
}) {
  const { topPerson, newPeople, newPlaces, newCountries, placesVisited, countriesVisited } = data;
  const hasAnything =
    topPerson !== null || placesVisited.total > 0 || countriesVisited.total > 0;

  return (
    <ChartCard
      title="People & places"
      description={`Who you spent ${periodLabel} with, and where you spent it.`}
      empty={!hasAnything}
    >
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CountCard label="New people met" count={newPeople} priorLabel={priorLabel} />
          <CountCard label="Places visited" count={placesVisited} priorLabel={priorLabel} />
          <CountCard label="Countries visited" count={countriesVisited} priorLabel={priorLabel} />
        </div>

        {topPerson ? (
          <div className="flex flex-col gap-0.5">
            <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              Most-logged person
            </p>
            <p className="text-lg font-medium">{topPerson.name}</p>
            <p className="text-xs text-muted-foreground">
              {topPerson.days} day{topPerson.days === 1 ? "" : "s"} together
              {topPerson.priorDays === null
                ? ` — not logged in ${priorLabel}`
                : ` · ${topPerson.priorDays} in ${priorLabel}`}
            </p>
          </div>
        ) : null}

        <Discoveries newPeople={newPeople} newPlaces={newPlaces} newCountries={newCountries} />

        {data.leaderboard.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              Most-visited places
            </h3>
            <PlaceLeaderboard entries={data.leaderboard} />
          </section>
        ) : null}

        {/* A year with no travel is a normal year, not a broken card — the
            map is simply omitted rather than rendered as an empty world. */}
        {data.countryVisits.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              Travel footprint
            </h3>
            <WorldVisitsChart data={data.countryVisits} />
          </section>
        ) : null}
      </div>
    </ChartCard>
  );
}

/** Counts run through the foundation's coverage rule with the count itself
 * as the coverage number, the same way the entertainment totals do (#171):
 * a period with none of something reads "nothing logged" rather than a
 * confident zero, and loses its comparison instead of measuring against a
 * period that had nothing either. */
function CountCard({
  label,
  count,
  priorLabel,
}: {
  label: string;
  count: RecapCount;
  priorLabel: string;
}) {
  return (
    <RecapStatCard
      label={label}
      priorLabel={priorLabel}
      stat={toRecapStat({
        value: count.total,
        loggedDays: count.total,
        requiredDays: MIN_DAYS_FOR_TOTAL,
        prior: count.priorTotal,
        priorLoggedDays: count.priorTotal,
      })}
    />
  );
}

function Discoveries({
  newPeople,
  newPlaces,
  newCountries,
}: {
  newPeople: RecapDiscovery;
  newPlaces: RecapDiscovery;
  newCountries: RecapDiscovery;
}) {
  const lines = [
    newPeople.total > 0
      ? `${plural(newPeople.total, "new person", "new people")}${examples(newPeople)}`
      : null,
    newPlaces.total > 0
      ? `${plural(newPlaces.total, "new place", "new places")}${examples(newPlaces)}`
      : null,
    newCountries.total > 0
      ? `First time in ${listSentence(newCountries.examples)}${
          newCountries.total > newCountries.examples.length
            ? ` and ${newCountries.total - newCountries.examples.length} more`
            : ""
        }`
      : null,
  ].filter((line) => line !== null);

  if (lines.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 border-t border-border/60 pt-4">
      <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">Firsts</p>
      {lines.map((line) => (
        <p key={line} className="text-sm">
          {line}
        </p>
      ))}
    </div>
  );
}

function examples(discovery: RecapDiscovery): string {
  if (discovery.examples.length === 0) return "";
  return ` — starting with ${listSentence(discovery.examples)}`;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function listSentence(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
