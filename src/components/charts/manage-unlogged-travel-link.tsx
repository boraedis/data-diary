import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

/**
 * A link from a map chart into the unlogged-travel manage surface (#367).
 *
 * On the chart pages rather than only under `/manage`, because noticing a
 * county is missing happens while looking at the map — that is the whole
 * moment this feature exists to serve, and making someone navigate the
 * manage tree to act on it is where the intent gets lost. #323 called this
 * out explicitly as part of the surface, not a nicety.
 *
 * Rides in `ChartPage`'s existing `filters` row rather than introducing
 * new chrome. That row is otherwise the view/period controls, so this sits
 * at its end and stays visually secondary — it is an escape hatch, not a
 * control that changes what the chart shows.
 */
export function ManageUnloggedTravelLink() {
  return (
    <Link
      href="/manage/places/unlogged-travel"
      className={buttonVariants({ variant: "ghost", size: "xs" })}
      title="Counties and countries travelled through but never logged as a day"
    >
      Unlogged travel
    </Link>
  );
}
