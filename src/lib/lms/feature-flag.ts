/**
 * SMS / LMS feature gate.
 * Default OFF — existing Airborne production behavior unchanged until enabled per org.
 */
export const LMS_FEATURE_FLAG_KEY = "sms.enabled" as const;

export function isLmsEnabled(featureFlags: unknown): boolean {
  if (!featureFlags || typeof featureFlags !== "object") return false;
  const flags = featureFlags as Record<string, unknown>;
  const row = flags[LMS_FEATURE_FLAG_KEY];
  if (typeof row === "boolean") return row;
  if (row && typeof row === "object" && "enabled" in row) {
    return Boolean((row as { enabled?: unknown }).enabled);
  }
  return false;
}
