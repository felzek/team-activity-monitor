import type { AppConfig } from "../config.js";
import { LlmError } from "./errors.js";

const REQUEST_TIMEOUT_MS = 30_000;

type GatewayConfig = Pick<
  AppConfig,
  "aiGatewayApiKey" | "vercelOidcToken" | "aiGatewayBaseUrl"
>;

function resolveGatewayToken(config: GatewayConfig): string | null {
  return config.aiGatewayApiKey ?? config.vercelOidcToken ?? null;
}

export function isGatewayConfigured(config: GatewayConfig): boolean {
  return Boolean(resolveGatewayToken(config));
}

export async function gatewayFetch(
  config: GatewayConfig,
  path: string,
  init?: RequestInit
): Promise<unknown> {
  const token = resolveGatewayToken(config);
  if (!token) {
    throw new LlmError(
      "Vercel AI Gateway is not configured. Set AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN.",
      {
        llmCode: "configuration_error",
        provider: "gateway",
        statusCode: 422,
      }
    );
  }

  const response = await fetch(`${config.aiGatewayBaseUrl.replace(/\/+$/, "")}${path}`, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const body: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      (body as { error?: { message?: string } })?.error?.message ??
      `HTTP ${response.status}`;

    throw new LlmError(message, {
      llmCode:
        response.status === 401
          ? "authentication_error"
          : response.status === 403
            ? "authorization_error"
            : response.status === 429
              ? "rate_limit_error"
              : response.status >= 500
                ? "provider_unavailable"
                : "unknown_provider_error",
      provider: "gateway",
      statusCode: response.status,
      retryable: response.status === 429 || response.status >= 500,
    });
  }

  return body;
}
