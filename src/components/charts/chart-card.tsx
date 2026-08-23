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
    <Card className="w-full">
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
