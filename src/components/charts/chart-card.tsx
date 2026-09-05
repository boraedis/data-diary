import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** Shared chrome around every chart page's main chart: title, one-line
 * description of what it shows, and an "empty" fallback so a chart with no
 * data yet (e.g. before any real --commit of the historical migration) reads
 * as "nothing logged" rather than a blank card or a crash. */
export function ChartCard({
  title,
  description,
  empty,
  children,
}: {
  title: string;
  description?: string;
  /** Pass true when there's no data to plot; renders a short message
   * instead of `children`. */
  empty?: boolean;
  children: React.ReactNode;
}) {
  return (
    // Half the usual card padding below sm — `--card-spacing` is the one
    // knob Card exposes for this, and it moves the header, the content and
    // the vertical rhythm together, so the title still lines up with the
    // chart's left edge. Combined with ChartPage's narrower mobile gutter
    // this hands roughly 40px back to the plot on a 375px screen, which is
    // over 13% more width for every chart in the app.
    <Card className="w-full [--card-spacing:--spacing(3)] sm:[--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nothing logged yet.
          </p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
