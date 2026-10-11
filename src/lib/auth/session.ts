import { auth } from "./config";
import { UnauthorizedError } from "@/lib/utils/errors";
import type { SessionUser } from "@/types";

// Use in Server Components and Route Handlers
export async function getSession(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError();
  }
  return session.user as unknown as SessionUser;
}

export async function getOptionalSession(): Promise<SessionUser | null> {
  try {
    const session = await auth();
    if (!session?.user?.id) return null;
    return session.user as unknown as SessionUser;
  } catch {
    return null;
  }
}
