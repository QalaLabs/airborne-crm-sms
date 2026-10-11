import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { listJobSources } from "@/lib/services/job-ingestion.service";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "jobs");
    return ok({ ...listJobSources(), pushEndpoint: "/api/webhooks/jobs-ingest" });
  } catch (err) {
    return handleError(err);
  }
}
