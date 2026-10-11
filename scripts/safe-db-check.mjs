// DB SAFETY INTERLOCK (Section 7 / H-04 remediations).
//
// Every admin script that can READ or WRITE the database MUST run through
// `assertSafeDatabaseUrl` BEFORE Prisma is invoked. Reasons:
//   - admin/.env targets the PRODUCTION Cloud SQL instance (34.93.180.179).
//   - Next.js and the Prisma CLI auto-load .env, so a bare `npm run build`,
//     `npm run db:migrate`, `npm run db:reset` or `npm run db:seed` silently
//     targets production.
//
// Rules enforced here (fail-closed):
//   1. process.env.DATABASE_URL MUST be set in the shell environment.
//      If it is missing we refuse to run: Prisma would auto-load .env
//      (production) instead.
//   2. Unless strict local mode is waived, the target MUST be a loopback
//      address (localhost / 127.0.0.1 / ::1) and the database name MUST equal
//      SAFE_DB_EXPECT_DB (default "airbone_test").
//   3. --allow-prod / SAFE_DB_ALLOW_PROD=1 additionally permits the target
//      when NODE_ENV === "production". This is the ONLY path used by real
//      production deploys (Cloud Run sets NODE_ENV=production).
//
// This module is intentionally dependency-free (plain Node ESM) so it also
// runs inside production build environments.

import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_EXPECT_DB = "airbone_test";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * @param {string} url
 * @returns {{ host: string | null, port: string | null, database: string | null, isLoopback: boolean }}
 */
export function parseDatabaseUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;
    return {
      host,
      port: u.port || null,
      database: (u.pathname || "").replace(/^\//, "").split("?")[0] || null,
      isLoopback: LOOPBACK_HOSTS.has(String(host).toLowerCase()),
    };
  } catch {
    return { host: null, port: null, database: null, isLoopback: false };
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ allowProd?: boolean }} [opts]
 * @returns {string} human-readable effective target description
 */
export function assertSafeDatabaseUrl(env = process.env, opts = {}) {
  const allowProd = Boolean(opts.allowProd) || env.SAFE_DB_ALLOW_PROD === "1";
  const expectDb = env.SAFE_DB_EXPECT_DB || DEFAULT_EXPECT_DB;

  const url = env.DATABASE_URL;
  if (!url || !/^postgres(ql)?:\/\//i.test(url)) {
    throw new Error(
      [
        "DATABASE_URL is not set in the shell environment.",
        `Prisma/Next would auto-load admin/.env and target PRODUCTION Cloud SQL (34.93.180.179:5432/airbornedb).`,
        `Pin a local test database first, e.g.:`,
        `  $env:DATABASE_URL="postgresql://postgres:postgres@localhost:5433/${expectDb}?schema=public"`,
        `  $env:DIRECT_URL="postgresql://postgres:postgres@localhost:5433/${expectDb}"`,
        `Or set SAFE_DB_EXPECT_DB to the local database name you are using.`,
      ].join("\n"),
    );
  }

  const parsed = parseDatabaseUrl(url);
  const direct = env.DIRECT_URL ? parseDatabaseUrl(env.DIRECT_URL) : null;

  const isProduction = env.NODE_ENV === "production";
  const localMatch = parsed.isLoopback && parsed.database === expectDb;
  const allowed = localMatch || (allowProd && isProduction);

  if (parsed.host && !parsed.isLoopback && !allowed) {
    throw new Error(
      [
        `Refusing to run: DATABASE_URL points at a non-loopback host "${parsed.host}" (db "${parsed.database}").`,
        `This is almost certainly the production Cloud SQL instance.`,
        `Allowed targets: loopback host + database "${expectDb}", or (only for deploys) NODE_ENV=production.`,
        `To override intentionally set SAFE_DB_ALLOW_PROD=1 along with NODE_ENV=production.`,
      ].join("\n"),
    );
  }
  if (parsed.isLoopback && parsed.database !== expectDb && !allowProd) {
    throw new Error(
      [
        `Refusing to run: local database is "${parsed.database}" but SAFE_DB_EXPECT_DB expects "${expectDb}".`,
        `Did you mean to reset/seed the disposable test database? Pin DATABASE_URL to .../${expectDb}?schema=public`,
        `or set SAFE_DB_EXPECT_DB="${parsed.database}".`,
      ].join("\n"),
    );
  }
  if (direct && direct.isLoopback !== parsed.isLoopback) {
    throw new Error(
      `Refusing to run: DATABASE_URL and DIRECT_URL disagree on whether the target is loopback ` +
        `("${parsed.host}" vs "${direct.host}"). Prisma migrations use DIRECT_URL.`,
    );
  }
  if (allowProd && isProduction && !localMatch) {
    // Explicitly acknowledged production path (Cloud Run deploy).
    return `PRODUCTION (explicitly allowed via NODE_ENV=production) -> ${parsed.host}:${parsed.port}/${parsed.database}`;
  }

  return `LOCAL test database -> ${parsed.host}:${parsed.port}/${parsed.database}`;
}

// ── CLI entry: only runs when this file is executed directly ──────────────
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const allowProd = process.argv.includes("--allow-prod");
  try {
    const target = assertSafeDatabaseUrl(process.env, { allowProd });
    const direct = process.env.DIRECT_URL
      ? parseDatabaseUrl(process.env.DIRECT_URL)
      : null;
    console.log(
      `[safe-db-check] OK — target: ${target}` +
        (direct ? ` | DIRECT_URL host: ${direct.host}` : ""),
    );
    process.exitCode = 0;
  } catch (err) {
    console.error("[safe-db-check] FAILED");
    console.error(err.message);
    process.exitCode = 1;
  }
}