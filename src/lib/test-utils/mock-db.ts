// A generic stand-in for the object src/lib/db.ts's getDb() returns, for
// unit-testing lib functions that run a drizzle query without a real
// Postgres connection. Real drizzle query builders are long fluent chains
// (`.select().from().where().orderBy()...`) that only resolve once
// awaited at the end — this mock doesn't inspect or validate any
// intermediate chain call (there's no `.where()` clause being evaluated
// here), it just hands back one pre-canned "what the query eventually
// resolved to" value per top-level select/insert/update/delete call, in
// the order those calls happen.
//
// What this catches: bugs in how a lib function *uses* query results —
// wrong destructuring, a missing null fallback, an off-by-one in a
// Promise.all ordering, mis-mapped fields. What this can NOT catch: a
// wrong `.where()`/`.groupBy()`/join — a malformed real query still needs
// an actual Postgres instance (or something like pg-mem) to catch. See
// #38's PR thread for why that's tracked as separate follow-up work
// rather than attempted here.
//
// Usage (see src/lib/project.test.ts for a full example):
//
//   const dbState = vi.hoisted(() => ({ current: undefined as MockDb | undefined }));
//   vi.mock("@/lib/db", () => ({ getDb: () => dbState.current }));
//
//   dbState.current = createMockDb([rowsForFirstDbCall, rowsForSecondDbCall]);
//   await functionUnderTest(); // its Nth top-level db call resolves to results[N]

type Chainable = Record<string, unknown>;

function createChain(result: unknown): Chainable {
  const resolved = Promise.resolve(result);
  const chain: Chainable = {
    then: resolved.then.bind(resolved),
    catch: resolved.catch.bind(resolved),
    finally: resolved.finally.bind(resolved),
  };
  // Any other method call in the chain (.from, .where, .values,
  // .onConflictDoUpdate, .returning, .groupBy, .orderBy, ...) is a no-op
  // that returns this same proxy, so the fluent call keeps working no
  // matter how long or short the real query's chain is. Must return
  // `proxy`, not the raw `chain` target — returning `chain` would drop
  // off the Proxy after one hop and break every call after the first.
  const proxy: Chainable = new Proxy(chain, {
    get(target, prop, receiver) {
      if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver);
      return () => proxy;
    },
  });
  return proxy;
}

export type MockDb = {
  select: (...args: unknown[]) => Chainable;
  insert: (...args: unknown[]) => Chainable;
  update: (...args: unknown[]) => Chainable;
  delete: (...args: unknown[]) => Chainable;
};

/**
 * `results[i]` is what the i-th top-level `db.select/insert/update/delete`
 * call (in call order) resolves to — normally the array of rows the real
 * query would produce, since drizzle always resolves a select or a
 * `.returning()` to an array (destructure `[row] = await ...` the same way
 * the real code does).
 */
export function createMockDb(results: unknown[]): MockDb {
  const queue = [...results];
  const nextResult = (): unknown => {
    if (queue.length === 0) {
      throw new Error(
        "createMockDb: ran out of queued results — the code under test issued more top-level DB calls than this test queued for."
      );
    }
    return queue.shift();
  };
  return {
    select: () => createChain(nextResult()),
    insert: () => createChain(nextResult()),
    update: () => createChain(nextResult()),
    delete: () => createChain(nextResult()),
  };
}
