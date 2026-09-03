import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBookDetails, searchBooks } from "@/lib/google-books";

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(body) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_BOOKS_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("searchBooks", () => {
  it("returns [] for a blank query without calling fetch", async () => {
    const fetchMock = mockFetchOnce({ items: [] });
    expect(await searchBooks("  ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a result and upgrades its thumbnail to https", async () => {
    mockFetchOnce({
      items: [
        {
          id: "abc123",
          volumeInfo: {
            title: "Dune",
            authors: ["Frank Herbert"],
            publishedDate: "1965",
            imageLinks: { thumbnail: "http://books.google.com/thumb.jpg" },
          },
        },
      ],
    });
    expect(await searchBooks("dune")).toEqual([
      {
        googleBooksId: "abc123",
        title: "Dune",
        authors: ["Frank Herbert"],
        publishedDate: "1965",
        thumbnailUrl: "https://books.google.com/thumb.jpg",
      },
    ]);
  });

  it("falls back to smallThumbnail when thumbnail is absent", async () => {
    mockFetchOnce({
      items: [{ id: "1", volumeInfo: { imageLinks: { smallThumbnail: "http://x/small.jpg" } } }],
    });
    expect((await searchBooks("x"))[0].thumbnailUrl).toBe("https://x/small.jpg");
  });

  it("defaults a missing title to 'Untitled' and missing authors to []", async () => {
    mockFetchOnce({ items: [{ id: "1", volumeInfo: {} }] });
    const [result] = await searchBooks("x");
    expect(result.title).toBe("Untitled");
    expect(result.authors).toEqual([]);
    expect(result.thumbnailUrl).toBeNull();
  });

  it("treats a missing 'items' field as no results", async () => {
    mockFetchOnce({});
    expect(await searchBooks("x")).toEqual([]);
  });

  it("throws if GOOGLE_BOOKS_API_KEY is not configured", async () => {
    vi.unstubAllEnvs();
    mockFetchOnce({ items: [] });
    await expect(searchBooks("x")).rejects.toThrow("GOOGLE_BOOKS_API_KEY");
  });
});

describe("getBookDetails", () => {
  it("maps full detail fields", async () => {
    mockFetchOnce({
      id: "abc123",
      volumeInfo: {
        title: "Dune",
        authors: ["Frank Herbert"],
        publisher: "Chilton Books",
        publishedDate: "1965",
        description: "A desert planet...",
        pageCount: 412,
        categories: ["Fiction"],
        imageLinks: { thumbnail: "http://x/thumb.jpg" },
      },
    });
    expect(await getBookDetails("abc123")).toEqual({
      googleBooksId: "abc123",
      title: "Dune",
      authors: ["Frank Herbert"],
      publisher: "Chilton Books",
      publishedDate: "1965",
      description: "A desert planet...",
      thumbnailUrl: "https://x/thumb.jpg",
      pageCount: 412,
      categories: ["Fiction"],
    });
  });

  it("defaults every optional field when volumeInfo is missing entirely", async () => {
    mockFetchOnce({ id: "1" });
    expect(await getBookDetails("1")).toEqual({
      googleBooksId: "1",
      title: "Untitled",
      authors: [],
      publisher: null,
      publishedDate: null,
      description: null,
      thumbnailUrl: null,
      pageCount: null,
      categories: [],
    });
  });

  it("URL-encodes the volume id in the request path", async () => {
    const fetchMock = mockFetchOnce({ id: "a/b" });
    await getBookDetails("a/b");
    const requestedUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestedUrl).toContain("/volumes/a%2Fb");
  });
});
