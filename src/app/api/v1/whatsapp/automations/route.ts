import { type NextRequest } from "next/server";
import { z } from "zod";
import {
  listInteraktAutomations,
  updateInteraktAutomation,
} from "@/lib/automation/interakt-automations";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { NotFoundError } from "@/lib/utils/errors";

const patchSchema = z.object({
  id: z.string().uuid(),
  workflowRef: z.string().trim().max(255).nullable().optional(),
  campaignRef: z.string().trim().max(255).nullable().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  templates: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(255),
        configuredIn: z.literal("interakt").optional(),
      }),
    )
    .optional(),
});

export async function GET() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "workflows");

    const automations = await listInteraktAutomations(ctx.orgId);
    return ok(automations);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "workflows");

    const body = patchSchema.parse(await req.json());
    const { id, ...input } = body;
    const templates = input.templates?.map((t) => ({
      name: t.name,
      configuredIn: "interakt" as const,
    }));
    const updated = await updateInteraktAutomation(ctx.orgId, id, {
      workflowRef: input.workflowRef,
      campaignRef: input.campaignRef,
      isActive: input.isActive,
      notes: input.notes,
      templates,
    });
    if (!updated) {
      throw new NotFoundError("interakt_automation", id);
    }
    const automations = await listInteraktAutomations(ctx.orgId);
    return ok(automations);
  } catch (err) {
    return handleError(err);
  }
}
