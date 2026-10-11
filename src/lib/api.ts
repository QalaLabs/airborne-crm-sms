export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/**
 * "Request validation failed" alone is useless to the user — append the
 * field-level reasons (zod issues or ValidationError details) when present.
 */
export function formatApiErrorMessage(
  error: { message?: string; details?: unknown } | undefined,
  status: number,
): string {
  const base = error?.message ?? `HTTP ${status}`;
  if (!Array.isArray(error?.details) || error.details.length === 0) return base;
  const reasons = error.details
    .slice(0, 3)
    .map((d) => {
      if (!d || typeof d !== "object") return null;
      const { path, message } = d as { path?: unknown; message?: unknown };
      if (typeof message !== "string") return null;
      const field = Array.isArray(path) && path.length ? `${path.join(".")}: ` : "";
      return `${field}${message}`;
    })
    .filter(Boolean);
  return reasons.length ? `${base} — ${reasons.join("; ")}` : base;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData =
    typeof FormData !== "undefined" && init?.body instanceof FormData;

  const res = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: "include",
    headers: isFormData
      ? { ...init?.headers }
      : {
          "Content-Type": "application/json",
          ...init?.headers,
        },
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; code?: string; details?: unknown };
    };
    throw new ApiClientError(
      formatApiErrorMessage(err?.error, res.status),
      err?.error?.code,
      res.status,
    );
  }

  if (res.status === 204) return undefined as T;

  const data = (await res.json()) as { data?: T } & T;
  return (data as { data?: T }).data ?? (data as T);
}

export function isStorageUnavailable(err: unknown): boolean {
  return (
    err instanceof ApiClientError && err.code === "STORAGE_UNAVAILABLE"
  );
}
