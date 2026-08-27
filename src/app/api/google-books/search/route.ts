import { NextResponse } from "next/server";
import { searchBooks } from "@/lib/google-books";

export const dynamic = "force-dynamic";

// Thin proxy in front of Google Books' search endpoint — exists purely so
// the API key (src/lib/google-books.ts) never has to reach the browser.
// Powers the debounced live-search box in the "+ Add from Google Books"
// flow (see components/entry-forms/book-entry-form.tsx).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  if (!query.trim()) {
    return NextResponse.json([]);
  }

  try {
    const results = await searchBooks(query);
    return NextResponse.json(results);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Google Books search failed" },
      { status: 502 }
    );
  }
}
