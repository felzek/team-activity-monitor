import { AppError } from "../lib/errors.js";
import type { LlmErrorCode, LlmProvider } from "./types.js";

export class LlmError extends AppError {
  readonly llmCode: LlmErrorCode;
  readonly provider?: LlmProvider;
  readonly retryable: boolean;

  constructor(
    message: string,
    opts: {
      llmCode: LlmErrorCode;
      provider?: LlmProvider;
      statusCode?: number;
      retryable?: boolean;
      cause?: unknown;
    }
  ) {
    super(message, {
      code: opts.llmCode,
      statusCode: opts.statusCode ?? httpStatusFor(opts.llmCode),
      cause: opts.cause,
    });
    this.name = "LlmError";
    this.llmCode = opts.llmCode;
    this.provider = opts.provider;
    this.retryable = opts.retryable ?? false;
  }
}

function httpStatusFor(code: LlmErrorCode): number {
  switch (code) {
    case "authentication_error":
      return 401;
    case "authorization_error":
      return 403;
    case "rate_limit_error":
      return 429;
    case "validation_error":
    case "invalid_model":
      return 400;
    case "provider_unavailable":
      return 503;
    case "timeout_error":
      return 504;
    case "configuration_error":
      return 422;
    default:
      return 502;
  }
}

/**
 * Converts an unknown provider error into a typed LlmError by inspecting
 * the message and HTTP status embedded in the error.
 */
export function normalizeProviderError(
  err: unknown,
  provider: LlmProvider,
  context: string
): LlmError {
  if (err instanceof LlmError) return err;

  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (
    lower.includes("401") ||
    lower.includes("unauthorized") ||
    lower.includes("invalid api key") ||
    lower.includes("incorrect api key") ||
    lower.includes("invalid x-api-key")
  ) {
    return new LlmError(`${provider} authentication failed. Check your API key.`, {
      llmCode: "authentication_error",
      provider,
      cause: err,
    });
  }

  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("quota exceeded")) {
    return new LlmError(`${provider} rate limit exceeded. Please try again shortly.`, {
      llmCode: "rate_limit_error",
      provider,
      retryable: true,
      cause: err,
    });
  }

  if (lower.includes("403")) {
    return new LlmError(`${provider} authorization failed. Check your API key permissions.`, {
      llmCode: "authorization_error",
      provider,
      cause: err,
    });
  }

  if (
    lower.includes("etimedout") ||
    lower.includes("econnreset") ||
    lower.includes("timed out") ||
    lower.includes("aborted")
  ) {
    return new LlmError(`${provider} request timed out. Please try again.`, {
      llmCode: "timeout_error",
      provider,
      retryable: true,
      cause: err,
    });
  }

  if (
    lower.includes("econnrefused") ||
    lower.includes("503") ||
    lower.includes("502") ||
    lower.includes("service unavailable") ||
    lower.includes("overloaded")
  ) {
    return new LlmError(`${provider} is temporarily unavailable.`, {
      llmCode: "provider_unavailable",
      provider,
      retryable: true,
      cause: err,
    });
  }

  return new LlmError(`${context}: ${msg}`, {
    llmCode: "unknown_provider_error",
    provider,
    cause: err,
  });
}
