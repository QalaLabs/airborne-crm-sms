import { prisma } from "@/lib/db/client";
import type { InngestStepApi } from "@/lib/workflow/runner";

/** Signals executeRun to stop until nextRunAt is reached (Cloud Run safe). */
export class WorkflowRunYield extends Error {
  readonly name = "WorkflowRunYield";
}

export function createDbStepApi(runId: string): InngestStepApi {
  return {
    run: async (_id, fn) => fn(),
    sleep: async (_id, ms) => {
      await prisma.workflowRun.update({
        where: { id: runId },
        data: { nextRunAt: new Date(Date.now() + ms) },
      });
      throw new WorkflowRunYield();
    },
  };
}
