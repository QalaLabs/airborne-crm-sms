import { NextResponse } from "next/server";
import { checkMaintenance } from "@/lib/middleware/maintenance";
import { handleError } from "@/lib/utils/response";
import { getGoogleReviews } from "@/lib/services/google-reviews";

export async function GET() {
  try {
    await checkMaintenance();
    return NextResponse.json({ data: await getGoogleReviews() });
  } catch (err) {
    return handleError(err);
  }
}
