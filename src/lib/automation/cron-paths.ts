/** Only this cron route is exempt from session middleware. */
export const CRON_AUTOMATION_PATH = "/api/cron/automation";

/** True when session auth middleware must NOT run (cron uses CRON_SECRET in the route handler). */
export function isCronAutomationPath(pathname: string): boolean {
  return pathname === CRON_AUTOMATION_PATH;
}

/** Mirrors `middleware.ts` matcher — testable without running Next.js middleware. */
export function shouldRunSessionMiddleware(pathname: string): boolean {
  if (pathname.startsWith("/_next/static")) return false;
  if (pathname.startsWith("/_next/image")) return false;
  if (pathname === "/favicon.ico") return false;
  if (isCronAutomationPath(pathname)) return false;
  return true;
}
