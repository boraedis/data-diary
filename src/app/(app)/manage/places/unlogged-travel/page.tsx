import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { UnloggedTravelManage } from "@/components/manage/unlogged-travel-manage";
import { getUnloggedTravelOverview } from "@/lib/unlogged-travel";

export const dynamic = "force-dynamic";

// #367 — the manage surface for unlogged travel (#323's epic).
//
// Lives under Places rather than as its own top-level /manage card: it's
// place-adjacent catalog data, which is exactly what this hub already
// collects (World View, Categories, Metros), and the five top-level cards
// are the app's real catalogs, which this isn't.
export default async function UnloggedTravelManagePage() {
  const { counties, countries } = await getUnloggedTravelOverview();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Unlogged travel</h1>
        <Link href="/manage/places" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; Places
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        Counties and countries travelled to or through that never made a day&apos;s top-two place slots. They show on
        the maps as travelled-through rather than blank &mdash; but a place with real logged days keeps its real
        colour, so an entry that overlaps one is hidden by design.
      </p>
      <UnloggedTravelManage counties={counties} countries={countries} />
    </main>
  );
}
