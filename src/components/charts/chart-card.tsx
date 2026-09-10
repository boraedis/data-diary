import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** Shared chrome around every chart page's main chart: an "empty" fallback
 * so a chart with no data yet (e.g. before any real --commit of the
 * historical migration) reads as "nothing logged" rather than a blank card
 * or a crash.
 *
 * `title`/`description` are optional and render a `CardHeader` when
 * present — but every `/charts/*` page now puts its title and description
 * in `ChartPage` instead (#315 removed the duplicate header this used to
 * render there). The props stay for the other, legitimate use of this
 * component: the recap report's section cards (`recap-health-section.tsx`
 * and siblings), which aren't paired with `ChartPage` and have no other
 * title of their own.
 *
 * A CSS-only attempt to also make this card stretch to fill the viewport
 * (a `fillHeight` prop, flexing `Card`/`CardContent` to fill whatever
 * height an ancestor resolved) shipped and then got reverted — see
 * chart-page.tsx's and responsive-chart.tsx's own comments on why. The
 * chart's height is sized directly on `ResponsiveChart` now
 * (`fillViewport`), so this component doesn't need to participate in
 * that at all. */
export function ChartCard({
  title,
  description,
  empty,
  children,
}: {
  title?: string;
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
      {title || description ? (
        <CardHeader>
          {title ? <CardTitle>{title}</CardTitle> : null}
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
      ) : null}
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
