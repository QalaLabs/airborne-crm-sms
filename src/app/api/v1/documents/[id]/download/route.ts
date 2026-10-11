import { NextResponse, type NextRequest } from "next/server";
import { DocumentService } from "@/lib/services/document.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { handleError } from "@/lib/utils/response";
import { AppError } from "@/lib/utils/errors";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "documents");
    const { id } = await params;

    const result = await DocumentService.resolveDownload(ctx, id);
    const safeName = result.doc.name.replace(/["\\\r\n]/g, "_");

    if (result.kind === "bytes") {
      return new NextResponse(new Uint8Array(result.bytes), {
        status: 200,
        headers: {
          "Content-Type": result.doc.fileMimeType ?? "application/octet-stream",
          "Content-Disposition": `inline; filename="${safeName}"`,
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
          "Cache-Control": "private, no-store",
        },
      });
    }

    if (!/^https:\/\//i.test(result.url)) {
      throw new AppError("DOWNLOAD_FAILED", "Document file location is invalid", 502);
    }
    return NextResponse.redirect(result.url, { status: 302, headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return handleError(err);
  }
}
