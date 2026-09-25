import { LeaderboardExplorer } from "@/components/charts/leaderboard";
import { pickOption, type LeaderboardPicker, type SearchParams } from "@/lib/leaderboards/options";
import {
  getWorkLeaderboardData,
  WORK_MEASURES,
  WORK_MODES,
  workColumns,
  type WorkMode,
} from "@/lib/leaderboards/work";
import { JOB_METHODOLOGY } from "@/lib/viz/methodology";
import { JOB_TRACKING_SPAN } from "@/lib/viz/tracking-span";

export const dynamic = "force-dynamic";

const DESCRIPTIONS: Record<WorkMode, string> = {
  job: "Every job, school included, ranked by how much I worked while it was active.",
  company: "Time worked by company, with every stint at the same place added together.",
  role: "Time worked in each role, promotions included.",
  location: "Where I work, ranked by days or hours spent working there.",
  commute: "How I get to work, ranked by days or hours worked after that commute.",
};

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const mode = pickOption(params.by, WORK_MODES);
  const measure = pickOption(params.measure, WORK_MEASURES);
  // Measure first: changing a picker clears every picker after it, and
  // flipping through Rank modes under "hours" is the common path — the
  // other order would reset hours back to days on every mode change.
  const pickers: LeaderboardPicker[] = [
    { param: "measure", label: "Measure", value: measure, options: WORK_MEASURES },
    { param: "by", label: "Rank", value: mode, options: WORK_MODES },
  ];
  const rows = await getWorkLeaderboardData(mode, measure);
  return (
    <LeaderboardExplorer
      title="Job Leaderboard"
      description={DESCRIPTIONS[mode]}
      methodology={JOB_METHODOLOGY}
      trackingSpan={JOB_TRACKING_SPAN}
      pickers={pickers}
      rows={rows}
      columns={workColumns(mode, measure)}
      ariaLabel="Jobs, companies, roles, work locations or commutes ranked by time worked, with how each has moved over the last week, month and year."
    />
  );
}
