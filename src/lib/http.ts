import type { Logger } from "pino";

import type { ProviderName } from "../types/activity.js";
import { ProviderError } from "./errors.js";

interface FetchJsonOptions {
  provider: ProviderName;
  logger?: Logger;
  timeoutMs?: number;
  retries?: number;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId)
  };
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit,
  options: FetchJsonOptions
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const retries = options.retries ?? 1;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const { signal, cleanup } = createTimeoutSignal(timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal,
        headers: {
          Accept: "application/json",
          ...(init.headers ?? {})
        }
      });

      cleanup();

      if (!response.ok) {
        const bodyText = await response.text();
        const retryable = RETRYABLE_STATUS_CODES.has(response.status);

        if (retryable && attempt < retries) {
          options.logger?.warn(
            {
              provider: options.provider,
              attempt,
              statusCode: response.status
            },
            "Retrying provider request after retryable status"
          );
          await sleep(400 * (attempt + 1));
          continue;
        }

        throw new ProviderError(options.provider, bodyText || response.statusText, {
          code: `${options.provider.toUpperCase()}_${response.status}`,
          statusCode: response.status,
          retryable
        });
      }

      return (await response.json()) as T;
    } catch (error) {
      cleanup();

      const isAbort =
        error instanceof DOMException && error.name === "AbortError";

      if (attempt < retries && (isAbort || error instanceof TypeError)) {
        options.logger?.warn(
          {
            provider: options.provider,
            attempt,
            error: error instanceof Error ? error.message : "Unknown fetch failure"
          },
          "Retrying provider request after transient failure"
        );
        await sleep(400 * (attempt + 1));
        continue;
      }

      if (error instanceof ProviderError) {
        throw error;
      }

      throw new ProviderError(
        options.provider,
        isAbort ? "Request timed out." : "Provider request failed.",
        {
          code: `${options.provider.toUpperCase()}_${isAbort ? "TIMEOUT" : "NETWORK_ERROR"}`,
          statusCode: isAbort ? 504 : 502,
          retryable: isAbort || error instanceof TypeError,
          cause: error
        }
      );
    }
  }

  throw new ProviderError(options.provider, "Provider request failed.", {
    code: `${options.provider.toUpperCase()}_UNEXPECTED`,
    statusCode: 502,
    retryable: false
  });
}
