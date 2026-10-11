import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";

const INACTIVE_ADMISSION_STAGES = new Set(["CANCELLED", "DROPPED"]);

export function isActiveAdmissionStage(stage: string | null | undefined): boolean {
  return !!stage && !INACTIVE_ADMISSION_STAGES.has(stage);
}

type LinkResult =
  | { linked: true; admissionId: string }
  | { linked: false; admissionId: string | null };

/**
 * Compare-and-swap link of a freshly created admission onto a deal.
 *
 * Only succeeds when `deal.admissionId` still equals `expectedPrevious` (the
 * value read before the admission was created). Postgres re-evaluates the
 * WHERE clause after acquiring the row lock, so of two concurrent converters
 * exactly one wins; the loser archives its own admission and adopts the
 * winner's, guaranteeing a single active admission per deal.
 */
export async function linkAdmissionToDeal(params: {
  orgId: string;
  dealId: string;
  expectedPrevious: string | null;
  admissionId: string;
  data?: Omit<Prisma.DealUncheckedUpdateManyInput, "admissionId">;
}): Promise<LinkResult> {
  const { orgId, dealId, expectedPrevious, admissionId, data } = params;

  let count = 0;
  try {
    const res = await prisma.deal.updateMany({
      where: { id: dealId, orgId, admissionId: expectedPrevious },
      data: { ...(data ?? {}), admissionId },
    });
    count = res.count;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code !== "P2002") throw err;
  }

  if (count === 1) return { linked: true, admissionId };

  await prisma.admission
    .update({
      where: { id: admissionId, orgId },
      data: { stage: "CANCELLED", notes: "Orphaned by concurrent conversion; archived." },
    })
    .catch(() => undefined);

  const current = await prisma.deal.findFirst({
    where: { id: dealId, orgId },
    select: { admissionId: true },
  });
  return { linked: false, admissionId: current?.admissionId ?? null };
}
