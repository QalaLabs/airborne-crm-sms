import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cronAuthHttpStatus, verifyCronSecret } from "@/lib/automation/cron-auth";
import { collectAutomationMetrics } from "@/lib/automation/metrics";
import {
  reconcileDueWorkflowRuns,
  reconcileUnprocessedEvents,
} from "@/lib/automation/workflow-dispatcher";
import { LeadService } from "@/lib/services/lead.service";
import { PageService } from "@/lib/services/page.service";
import { CourseService } from "@/lib/services/course.service";
import { ResourceService } from "@/lib/services/resource.service";
import { LeadTrashService } from "@/lib/services/lead-trash.service";

export async function POST(req: NextRequest) {
  const auth = verifyCronSecret(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: "unauthorized", reason: auth.failure },
      { status: cronAuthHttpStatus(auth.failure) },
    );
  }

  try {
    const [metrics, workflows, events, fallback, pagesPublished, coursesPublished, resourcesPublished, leadTrash] =
      await Promise.all([
        collectAutomationMetrics(),
        reconcileDueWorkflowRuns(50),
        reconcileUnprocessedEvents(50),
        LeadService.syncFallbackLeadsCron(),
        PageService.publishScheduledPages(),
        CourseService.publishScheduledCourses(),
        ResourceService.publishScheduledResources(),
        LeadTrashService.purgeExpired(),
      ]);

    return NextResponse.json({
      ok: true,
      ts: new Date().toISOString(),
      metrics,
      workflows,
      events,
      fallbackLeads: fallback,
      pagesPublished,
      coursesPublished,
      resourcesPublished,
      leadTrash,
    });
  } catch (err) {
    console.error("[Cron/automation] failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
