import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { isAutomationEngineEnabled } from "@/lib/events/dispatch";

export const dynamic = "force-dynamic";

// Readiness: checks the database and reports automation engine status.
export async function GET() {
  let dbOk = false;
  let dbError: string | null = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const ready = dbOk;

  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      checks: {
        database: dbOk,
        automation_engine: isAutomationEngineEnabled(),
      },
      error: dbError,
    },
    { status: ready ? 200 : 503 },
  );
}
