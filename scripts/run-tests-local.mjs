// Section 7 / H-04: local test runner.
//
// Usage:  npm run test:local
//
// 1. Fails closed unless DATABASE_URL (shell env) targets a LOOPBACK host and
//    SAFE_DB_EXPECT_DB (default "airbone_test") — never the prod .env.
// 2. Enables every integration gate (SECTION5/SECTION6/FEES/DEALS/ADMISSION/
//    LMS_OPS) so the full 254-test suite runs against the disposable DB.
// 3. Runs `node --import tsx --test "src/**/*.test.ts"` with clean stdio.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { assertSafeDatabaseUrl } from "./safe-db-check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATES = [
  "SECTION5_INTEGRATION",
  "SECTION6_INTEGRATION",
  "FEES_INTEGRATION",
  "DEALS_INTEGRATION",
  "ADMISSION_INTEGRATION",
  "LMS_OPS_INTEGRATION",
  "WORKFLOW_INTEGRATION",
];

try {
  const target = assertSafeDatabaseUrl(process.env);
  console.log(`[run-tests-local] ${target}`);
} catch (err) {
  console.error("[run-tests-local] refusing to run tests:");
  console.error(err.message);
  process.exit(1);
}

for (const gate of GATES) {
  if (!process.env[gate]) process.env[gate] = "1";
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", "src/**/*.test.ts"],
  { cwd: dirname(HERE), stdio: "inherit", env: process.env },
);

process.exit(result.status === null ? 1 : result.status);