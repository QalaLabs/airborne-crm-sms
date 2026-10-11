import { NextResponse, type NextRequest } from "next/server";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { handleError } from "@/lib/utils/response";
import { AppError, NotFoundError } from "@/lib/utils/errors";
import { AdmissionLetterService } from "@/lib/services/admission-letter.service";
import type { LetterKind } from "@/lib/admissions/letters";

type Params = { params: Promise<{ id: string; kind: string }> };

const KINDS: LetterKind[] = ["offer", "fee-update"];

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "admissions");
    const { id, kind } = await params;
    if (!KINDS.includes(kind as LetterKind)) throw new NotFoundError("Letter", kind);
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("VALIDATION_ERROR", "Invalid admission id", 400);

    const { html, approved } = await AdmissionLetterService.render(ctx, id, kind as LetterKind);
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "X-Letter-Approved": approved ? "true" : "false",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
