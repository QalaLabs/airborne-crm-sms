// ─── Application Error Classes ───────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown[],
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      `${resource.toUpperCase()}_NOT_FOUND`,
      id ? `${resource} with id ${id} not found` : `${resource} not found`,
      404,
    );
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super("UNAUTHORIZED", message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(action?: string, resource?: string) {
    const msg =
      action && resource
        ? `You do not have permission to ${action} ${resource}`
        : "Access denied";
    super("FORBIDDEN", msg, 403);
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown[]) {
    super("VALIDATION_ERROR", "Request validation failed", 400, details);
    this.name = "ValidationError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
    this.name = "ConflictError";
  }
}

export class RateLimitError extends AppError {
  constructor() {
    super("RATE_LIMIT_EXCEEDED", "Too many requests. Slow down.", 429);
    this.name = "RateLimitError";
  }
}

export class StorageUnavailableError extends AppError {
  constructor(message = "Media storage is not configured") {
    super("STORAGE_UNAVAILABLE", message, 503);
    this.name = "StorageUnavailableError";
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
