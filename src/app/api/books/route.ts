import { NextResponse } from "next/server";
import { createBookCatalogEntry, listBooksCatalog, validateBookCatalogRequest } from "@/lib/days";
import { getBookDetails } from "@/lib/google-books";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listBooksCatalog();
  return NextResponse.json(items);
}

/** Unlike places/people (manual field entry), a new book only needs a
 * googleBooksId from the client — the rest of the catalog row (title,
 * authors, publisher, description, page count, categories) is fetched
 * server-side from Google Books and upserted here, so the client never has
 * to duplicate or fake that metadata, and the API key never leaves the
 * server. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateBookCatalogRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const details = await getBookDetails(parsed.value.googleBooksId);
    const created = await createBookCatalogEntry(details);
    return NextResponse.json(created);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
