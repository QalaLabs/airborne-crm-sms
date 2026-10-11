import { type NextRequest } from "next/server";
import { DocumentService } from "@/lib/services/document.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { reviewDocumentSchema } from "@/lib/validations/document.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "documents");

    const doc = await DocumentService.getById(ctx, id);
    return ok(doc);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "approve", "documents");

    const body = await req.json() as unknown;
    const input = reviewDocumentSchema.parse(body);

    const doc = await DocumentService.review(ctx, id, input);
    return ok(doc);
  } catch (err) {
    return handleError(err);
  }
}
