import { notFound } from "next/navigation";
import { PersonDetail } from "@/components/manage/person-detail";
import { getPersonCatalogEntry, getPersonUsage } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManagePersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const person = await getPersonCatalogEntry(id);
  if (!person) {
    notFound();
    return;
  }
  const usage = await getPersonUsage(id);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <PersonDetail person={person} usage={usage} />
    </main>
  );
}
