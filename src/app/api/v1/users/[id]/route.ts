import { type NextRequest } from "next/server";
import { UserService } from "@/lib/services/user.service";
import { guard } from "@/lib/middleware/permissions";
import { hasPermission } from "@/lib/utils/permissions";
import { ForbiddenError } from "@/lib/utils/errors";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { updateUserSchema } from "@/lib/validations/user.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "users");

    const user = await UserService.getById(ctx, id);
    return ok(user);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;

    // Users can always update their own profile
    if (ctx.user.id !== id) {
      guard(ctx.user, "write", "users");
    }

    const body = await req.json() as unknown;
    const input = updateUserSchema.parse(body);

    // Self-service profile edits cannot move campus (drives campus ABAC) or
    // toggle activation — those stay behind users:write.
    if (ctx.user.id === id && !hasPermission(ctx.user, "write", "users")) {
      if (input.campusId !== undefined || input.isActive !== undefined) {
        throw new ForbiddenError("write", "users");
      }
    }
    if (ctx.user.id === id && input.isActive === false) {
      throw new ForbiddenError("deactivate", "your own account");
    }

    const user = await UserService.update(ctx, id, input);
    return ok(user);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "delete", "users");

    await UserService.deactivate(ctx, id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
