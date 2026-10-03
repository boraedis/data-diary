import type { ReactNode } from "react";
import { ChartCard } from "@/components/charts/chart-card";
import { LeaderboardTable } from "@/components/charts/leaderboard";
import { RecapStatCard } from "@/components/recap/recap-stat-card";
import { workColumns } from "@/lib/leaderboards/work";
import type { LeaderboardColumns } from "@/lib/leaderboards/rows";
import { MIN_DAYS_FOR_AVERAGE, MIN_DAYS_FOR_TOTAL, toRecapStat } from "@/lib/recap";
import type { RecapDailyMetric } from "@/lib/recap-body";
import type { RecapScreenTime, RecapWork } from "@/lib/recap-work";
import { formatDate, formatDuration, formatPercent } from "@/lib/viz/format";

// The work & screen time section of the recap report (#530, slice 4 of
// #521). The rules live in `recap-work.ts`'s header: days worked reads
// `dayType` and gates on typed days; hours, productivity and screen time are
// averages over the days that logged them, gated on `MIN_DAYS_FOR_AVERAGE`.
//
// A card whose column was logged in *neither* period is dropped rather than
// shown as "Nothing logged" — the entertainment section's rule for a medium
// the diary didn't track yet. Logged in one period but too thinly is
// different: that card stays and says how many days it had, which is how a
// month in early May 2026 reads before hours tracking had two weeks behind
// it.

// Reuses the job leaderboard's own column config so headers and value
// descriptions can't drift from /charts/job-leaderboard.
const TABLES: { key: "jobs" | "locations" | "commute"; title: string; columns: LeaderboardColumns }[] = [
  { key: "jobs", title: "Days worked by job", columns: workColumns("job", "days") },
  { key: "locations", title: "Where you worked", columns: workColumns("location", "days") },
  { key: "commute", title: "How you got there", columns: workColumns("commute", "days") },
];

const everLogged = (metric: RecapDailyMetric) => metric.daysLogged > 0 || metric.priorDaysLogged > 0;

const averageStat = (metric: RecapDailyMetric) =>
  toRecapStat({
    value: metric.average ?? 0,
    loggedDays: metric.daysLogged,
    requiredDays: MIN_DAYS_FOR_AVERAGE,
    prior: metric.priorAverage,
    priorLoggedDays: metric.priorDaysLogged,
  });

const formatMinutes = (minutes: number) => formatDuration(minutes / 60);

export function RecapWorkSection({
  work,
  screenTime,
  periodLabel,
  priorLabel,
}: {
  work: RecapWork;
  screenTime: RecapScreenTime;
  periodLabel: string;
  priorLabel: string;
}) {
  const { phone, laptop, instagram, instagramShare, followers } = screenTime;
  const showDaysWorked = work.daysTyped > 0 || work.priorDaysTyped > 0;
  const workCards = showDaysWorked || everLogged(work.hours) || everLogged(work.productivity);
  const tables = TABLES.map((table) => ({ ...table, rows: work[table.key] })).filter((table) => table.rows.length > 0);
  const screenCards =
    everLogged(phone) || everLogged(laptop) || everLogged(instagram) || followers.daysLogged > 0;

  return (
    <ChartCard
      title="Work & screen time"
      description={`Days worked, hours and screens in ${periodLabel}.`}
      empty={!workCards && tables.length === 0 && !screenCards}
    >
      <div className="flex flex-col gap-6">
        {workCards ? (
          <Group title="Work">
            {showDaysWorked ? (
              <RecapStatCard
                label="Days worked"
                unit="days"
                priorLabel={priorLabel}
                detail={
                  work.daysTyped > 0
                    ? `${formatPercent(work.daysWorked / work.daysTyped)} of ${work.daysTyped.toLocaleString()} days with a day type`
                    : undefined
                }
                stat={toRecapStat({
                  value: work.daysWorked,
                  loggedDays: work.daysTyped,
                  requiredDays: MIN_DAYS_FOR_TOTAL,
                  prior: work.priorDaysWorked,
                  priorLoggedDays: work.priorDaysTyped,
                })}
              />
            ) : null}
            {everLogged(work.hours) ? (
              <RecapStatCard
                label="Hours per day worked"
                format={formatDuration}
                priorLabel={priorLabel}
                detail={`${Math.round(work.hours.total).toLocaleString()} hours across ${work.hours.daysLogged.toLocaleString()} logged days`}
                stat={averageStat(work.hours)}
              />
            ) : null}
            {everLogged(work.productivity) ? (
              <RecapStatCard
                label="Average productivity"
                format={(value) => `${Math.round(value)}%`}
                priorLabel={priorLabel}
                detail={`Self-rated, across ${work.productivity.daysLogged.toLocaleString()} logged days`}
                stat={averageStat(work.productivity)}
              />
            ) : null}
          </Group>
        ) : null}

        {tables.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {tables.map((table) => (
              <section key={table.key} className="flex min-w-0 flex-col gap-2">
                <h3 className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
                  {table.title}
                </h3>
                <LeaderboardTable
                  rows={table.rows}
                  columns={table.columns}
                  ariaLabel={`${table.title} in ${periodLabel}, ranked.`}
                />
              </section>
            ))}
          </div>
        ) : null}

        {screenCards ? (
          <Group title="Screen time">
            {everLogged(phone) ? (
              <RecapStatCard
                label="Phone per day"
                format={formatMinutes}
                priorLabel={priorLabel}
                detail={`Across ${phone.daysLogged.toLocaleString()} logged days`}
                stat={averageStat(phone)}
              />
            ) : null}
            {everLogged(laptop) ? (
              <RecapStatCard
                label="Laptop per day"
                format={formatMinutes}
                priorLabel={priorLabel}
                detail={`Across ${laptop.daysLogged.toLocaleString()} logged days`}
                stat={averageStat(laptop)}
              />
            ) : null}
            {everLogged(instagram) ? (
              <RecapStatCard
                label="Instagram per day"
                format={formatMinutes}
                priorLabel={priorLabel}
                detail={
                  instagramShare !== null
                    ? `Part of phone time — ${formatPercent(instagramShare)} of it on days both were logged`
                    : "Part of phone time, not on top of it"
                }
                stat={averageStat(instagram)}
              />
            ) : null}
            {followers.last !== null ? (
              <RecapStatCard
                label="Instagram followers"
                priorLabel={priorLabel}
                detail={
                  followers.first && followers.first.date !== followers.last.date
                    ? `${followers.first.value.toLocaleString()} on ${formatDate(followers.first.date, "short")} → ${followers.last.value.toLocaleString()} on ${formatDate(followers.last.date, "short")}`
                    : `As of ${formatDate(followers.last.date, "short")}`
                }
                // A running total: the period's number is where it ended,
                // compared with where the period before ended.
                stat={toRecapStat({
                  value: followers.last.value,
                  loggedDays: followers.daysLogged,
                  requiredDays: MIN_DAYS_FOR_TOTAL,
                  prior: followers.priorLast?.value ?? null,
                  priorLoggedDays: followers.priorDaysLogged,
                })}
              />
            ) : null}
          </Group>
        ) : null}
      </div>
    </ChartCard>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-medium tracking-widest text-muted-foreground uppercase">{title}</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}
