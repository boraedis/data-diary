import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

// Lazily create the DB client on first real use rather than at module
// import time. Next.js imports every route handler during `next build`
// (its "collecting page data" step) purely to inspect it — it doesn't have
// DATABASE_URL available at that point, and doesn't need to. Throwing at
// module scope broke the build; throwing only when something actually
// queries the database is the correct behavior.
let cachedSql: NeonQueryFunction<false, false> | undefined;

function getConnectionString(): string {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error("DATABASE_URL is not set");
  }
  return value;
}

export function getSql(): NeonQueryFunction<false, false> {
  if (!cachedSql) {
    cachedSql = neon(getConnectionString());
  }
  return cachedSql;
}

export function getDb() {
  return drizzle(getSql());
}
