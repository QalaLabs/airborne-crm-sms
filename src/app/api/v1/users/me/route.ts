import { type NextRequest } from "next/server";
import { getRequestContext } from "@/lib/middleware/context";
import { prisma } from "@/lib/db/client";
import { UserService } from "@/lib/services/user.service";
import { ok, handleError } from "@/lib/utils/response";
import { z } from "zod";

const updateProfileSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: z.string().max(20).optional().nullable(),
  avatarUrl: z.string().url().optional().nullable(),
});

export async function GET(_req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    const user = await prisma.user.findUnique({
      where: { id: ctx.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        avatarUrl: true,
        isActive: true,
        campusId: true,
        createdAt: true,
      },
    });
    return ok(user);
  } catch (err) {
    return handleError(err);
  }
}

// Authenticated self-service profile update — acts on the session user only.
// Portal cadets (STUDENT) also sync the linked Student record via the service.
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    const body = await req.json();
    const input = updateProfileSchema.parse(body);

    const updated = await UserService.updateSelfProfile(ctx, input);
    return ok(updated);
  } catch (err) {
    return handleError(err);
  }
}
