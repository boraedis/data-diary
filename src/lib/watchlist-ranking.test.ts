import { describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mock-db";
import { RANKING_SIZE, setBookRanking, setMovieRanking } from "@/lib/days";

// Covers setMovieRanking/setBookRanking's own validation (issue #124) —
// max size, no duplicates, every id must exist — using the same
// mocked-drizzle-client strategy as days-validation.test.ts. The
// list/add/remove functions alongside these are thin single-query wrappers
// not worth mocking a whole chain for; this focuses on the one place with
// real logic to get wrong.

const dbState = vi.hoisted(() => ({ current: undefined as MockDb | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => dbState.current }));

describe("setMovieRanking", () => {
  it(`rejects more than ${RANKING_SIZE} movies without touching the database`, async () => {
    dbState.current = createMockDb([]);
    const ids = Array.from({ length: RANKING_SIZE + 1 }, (_, i) => i + 1);
    await expect(setMovieRanking(ids)).rejects.toThrow(`Ranking can hold at most ${RANKING_SIZE} movies`);
  });

  it("rejects a duplicate movie id without touching the database", async () => {
    dbState.current = createMockDb([]);
    await expect(setMovieRanking([1, 2, 1])).rejects.toThrow("Ranking cannot contain the same movie twice");
  });

  it("rejects a movie id that doesn't exist in the catalog", async () => {
    // findMissingMovieIds' select resolves to only id 1 being found, so 2 is reported missing.
    dbState.current = createMockDb([[{ id: 1 }]]);
    await expect(setMovieRanking([1, 2])).rejects.toThrow("Movie not found: 2");
  });

  it("replaces the ranking table with the given order on success", async () => {
    const insertedRows: unknown[] = [];
    dbState.current = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ id: 1 }, { id: 2 }]) }) }) as never,
      insert: () => ({
        values: (rows: unknown) => {
          insertedRows.push(rows);
          return Promise.resolve(undefined);
        },
      }) as never,
      delete: () => Promise.resolve(undefined) as never,
      update: () => Promise.resolve(undefined) as never,
    };
    await setMovieRanking([2, 1]);
    expect(insertedRows).toEqual([
      [
        { rank: 1, movieId: 2 },
        { rank: 2, movieId: 1 },
      ],
    ]);
  });

  it("skips the insert entirely when clearing the ranking (empty list)", async () => {
    let insertCalled = false;
    dbState.current = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) as never,
      insert: () => {
        insertCalled = true;
        return { values: () => Promise.resolve(undefined) } as never;
      },
      delete: () => Promise.resolve(undefined) as never,
      update: () => Promise.resolve(undefined) as never,
    };
    await setMovieRanking([]);
    expect(insertCalled).toBe(false);
  });
});

describe("setBookRanking", () => {
  it(`rejects more than ${RANKING_SIZE} books without touching the database`, async () => {
    dbState.current = createMockDb([]);
    const ids = Array.from({ length: RANKING_SIZE + 1 }, (_, i) => i + 1);
    await expect(setBookRanking(ids)).rejects.toThrow(`Ranking can hold at most ${RANKING_SIZE} books`);
  });

  it("rejects a duplicate book id without touching the database", async () => {
    dbState.current = createMockDb([]);
    await expect(setBookRanking([5, 5])).rejects.toThrow("Ranking cannot contain the same book twice");
  });

  it("rejects a book id that doesn't exist in the catalog", async () => {
    dbState.current = createMockDb([[]]);
    await expect(setBookRanking([9])).rejects.toThrow("Book not found: 9");
  });

  it("replaces the ranking table with the given order on success", async () => {
    const insertedRows: unknown[] = [];
    dbState.current = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ id: 3 }, { id: 7 }]) }) }) as never,
      insert: () => ({
        values: (rows: unknown) => {
          insertedRows.push(rows);
          return Promise.resolve(undefined);
        },
      }) as never,
      delete: () => Promise.resolve(undefined) as never,
      update: () => Promise.resolve(undefined) as never,
    };
    await setBookRanking([3, 7]);
    expect(insertedRows).toEqual([
      [
        { rank: 1, bookId: 3 },
        { rank: 2, bookId: 7 },
      ],
    ]);
  });
});
