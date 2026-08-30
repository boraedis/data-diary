import { NextResponse } from "next/server";
import { deleteEntertainmentKindEntry, getEntertainmentKindUsage } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

// Custom kinds only — deleteEntertainmentKindEntry itself refuses a system
// kind (Movie/TV show/Sport/Book/Game), and there's no delete button next
// to one in the UI either. entertainmentCatalog.kindId is onDelete:
// "restrict", so this is also the real block-if-in-use check.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const usage = await getEntertainmentKindUsage(id);
  if (usage.catalogCount > 0) {
    return NextResponse.json({ error: "Still in use", usage }, { status: 409 });
  }

  try {
    await deleteEntertainmentKindEntry(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
