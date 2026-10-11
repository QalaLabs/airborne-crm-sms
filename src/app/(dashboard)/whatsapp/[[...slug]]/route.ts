import { NextResponse } from "next/server";
import { interaktDashboardUrl } from "@/lib/whatsapp/interakt-link";

export const dynamic = "force-dynamic";

/** Legacy /whatsapp/* bookmarks: WhatsApp is managed in Interakt now. */
export function GET() {
  return NextResponse.redirect(interaktDashboardUrl(process.env.NEXT_PUBLIC_INTERAKT_DASHBOARD_URL), 307);
}
