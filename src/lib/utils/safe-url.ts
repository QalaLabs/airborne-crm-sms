/** Returns the URL only when it is an absolute http(s) URL; anything else (javascript:, data:, relative) is null. */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.host) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isHttpUrl(value: string): boolean {
  return safeHttpUrl(value) !== null;
}
