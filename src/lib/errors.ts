import type { ProviderName } from "../types/activity.js";

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly expose: boolean;

  constructor(
    message: string,
    options: {
      code: string;
      statusCode?: number;
      expose?: boolean;
      cause?: unknown;
    }
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    this.statusCode = options.statusCode ?? 500;
    this.expose = options.expose ?? true;
  }
}

export class ProviderError extends AppError {
  readonly provider: ProviderName;
  readonly retryable: boolean;

  constructor(
    provider: ProviderName,
    message: string,
    options: {
      code: string;
      statusCode?: number;
      retryable?: boolean;
      cause?: unknown;
    }
  ) {
    super(message, {
      code: options.code,
      statusCode: options.statusCode,
      expose: true,
      cause: options.cause
    });
    this.name = "ProviderError";
    this.provider = provider;
    this.retryable = options.retryable ?? false;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}
