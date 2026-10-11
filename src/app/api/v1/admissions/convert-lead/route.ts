import { type NextRequest } from "next/server";
import { z } from "zod";
import { LeadService } from "@/lib/services/lead.service";
import { AdmissionService } from "@/lib/services/admission.service";
import { guard, getCounselorCondition, guardRecord } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";

const convertLeadToAdmissionSchema = z.object({
  leadId: z.string().uuid(),
  courseName: z.string().optional(),
  courseId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  campusId: z.string().uuid().optional(),
  feePlanId: z.string().uuid().optional(),
  feeAmount: z.number().positive().optional(),
  notes: z.string().max(5000).optional(),
  autoEnroll: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "leads");
    guard(ctx.user, "write", "admissions");

    const body = (await req.json().catch(() => ({}))) as unknown;
    const input = convertLeadToAdmissionSchema.parse(body);

    const existing = await LeadService.getById(ctx, input.leadId);
    const condition = getCounselorCondition(ctx.user);
    guardRecord(ctx.user, "write", "leads", existing as unknown as Record<string, unknown>, condition);

    const result = await LeadService.convertToAdmission(ctx, input.leadId, {
      courseName: input.courseName ?? existing.courseInterest ?? undefined,
      campusId: input.campusId ?? existing.campusId ?? undefined,
      counselorId: existing.assignedTo ?? undefined,
      feeAmount: input.feeAmount ?? (existing.manualAmount ? Number(existing.manualAmount) : undefined),
      notes: input.notes,
      dealData: {
        courseId: input.courseId,
        batchId: input.batchId,
        feePlanId: input.feePlanId,
        value: input.feeAmount ?? (existing.manualAmount ? Number(existing.manualAmount) : undefined),
      },
    });

    // If autoEnroll requested, advance directly to ENROLLED
    if (input.autoEnroll && result.admission.id) {
      const enrolled = await AdmissionService.changeStage(ctx, result.admission.id, {
        toStage: "ENROLLED",
        createStudent: true,
        notes: "Direct student admission enrollment",
      });
      return ok({ admission: enrolled, created: result.created, enrolled: true });
    }

    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
