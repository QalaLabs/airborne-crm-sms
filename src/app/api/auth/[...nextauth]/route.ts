import type { NextRequest } from "next/server";
import { handlers } from "@/lib/auth/config";
import { guardCredentialsLogin } from "@/lib/auth/login-guard";

export const { GET } = handlers;

export async function POST(req: NextRequest) {
  const guarded = await guardCredentialsLogin(req);
  if (!guarded.request) return guarded.response;
  return handlers.POST(guarded.request);
}