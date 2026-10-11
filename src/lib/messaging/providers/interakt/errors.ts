// Structured Interakt provider errors. Callers persist `code` + `message`;
// never throw these across a request boundary unless the caller asked for it.

export type InteraktErrorCode =
  | "NOT_CONFIGURED"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "PAYLOAD_TOO_LARGE"
  | "TEMPLATE_REQUIRED"
  | "INVALID_PHONE"
  | "NETWORK"
  | "UNEXPECTED";

export class InteraktError extends Error {
  readonly code: InteraktErrorCode;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(code: InteraktErrorCode, message: string, opts?: { status?: number; retryable?: boolean }) {
    super(message);
    this.name = "InteraktError";
    this.code = code;
    this.status = opts?.status;
    this.retryable = opts?.retryable ?? false;
  }
}

export function errorFromHttpStatus(status: number, bodyMessage?: string): InteraktError {
  const detail = bodyMessage?.trim() ? `: ${bodyMessage.trim()}` : "";
  if (status === 401 || status === 403) {
    return new InteraktError("UNAUTHORIZED", `Interakt rejected credentials (${status})${detail}`, { status });
  }
  if (status === 429) {
    return new InteraktError("RATE_LIMITED", `Interakt rate limit exceeded${detail}`, {
      status,
      retryable: true,
    });
  }
  if (status === 400) {
    return new InteraktError("BAD_REQUEST", `Interakt rejected payload (400)${detail}`, { status });
  }
  if (status >= 500) {
    return new InteraktError("UNEXPECTED", `Interakt server error (${status})${detail}`, {
      status,
      retryable: true,
    });
  }
  return new InteraktError("UNEXPECTED", `Interakt HTTP ${status}${detail}`, { status });
}
