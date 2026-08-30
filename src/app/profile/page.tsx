import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { OwnerIdentityForm } from "@/components/profile/owner-identity-form";
import { ProfileTimelineEditor } from "@/components/profile/profile-timeline-editor";
import { listPeopleCatalog, listPlacesCatalog } from "@/lib/days";
import { getProfileSettings, listProfileOccupations, listProfileRelationships, listProfileResidences } from "@/lib/profile";

export const dynamic = "force-dynamic";

// The legacy app's `/entry/profile` — see #11: owner identity (name,
// birthdate, diary start date) plus the three profile timelines
// (occupation, residence, relationship). Not under /manage — this isn't a
// "fix a typo'd catalog entry" page, it's the app's own about-you section,
// same distinction the issue thread draws between this and a catalog.
export default async function ProfilePage() {
  const [settings, occupations, residences, relationships, places, people] = await Promise.all([
    getProfileSettings(),
    listProfileOccupations(),
    listProfileResidences(),
    listProfileRelationships(),
    listPlacesCatalog(),
    listPeopleCatalog(),
  ]);

  const placeOptions = places.map((p) => ({ id: p.id, name: p.name }));
  const peopleOptions = people.map((p) => ({ id: p.id, name: p.name }));

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Profile</h1>
        <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Home
        </Link>
      </div>

      <OwnerIdentityForm initial={settings} />

      <ProfileTimelineEditor type="occupation" title="Occupation" entries={occupations} places={placeOptions} />
      <ProfileTimelineEditor type="residence" title="Residence" entries={residences} places={placeOptions} />
      <ProfileTimelineEditor type="relationship" title="Relationship" entries={relationships} people={peopleOptions} />
    </main>
  );
}
