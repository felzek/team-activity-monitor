import type { Logger } from "pino";

import type { AppDatabase } from "../db.js";
import type { LlmProvider } from "../types/auth.js";
import { LlmError, normalizeProviderError } from "./errors.js";
import { LlmProviderRegistry } from "./registry.js";
import type {
  NormalizedChatRequest,
  NormalizedChatResponse,
  NormalizedModel,
  ProviderHealth,
} from "./types.js";

/**
 * Provider display priority — lower = shown first in sorted results.
 * local is intentionally last since the UI groups local models separately.
 */
const PROVIDER_PRIORITY: Record<string, number> = {
  gateway: 0,
  claude: 1,
  openai: 2,
  gemini: 3,
  local: 99,
};

type KeyedProvider = Extract<LlmProvider, "claude" | "openai" | "gemini">;

export class LlmService {
  constructor(
    private readonly registry: LlmProviderRegistry,
    private readonly database: AppDatabase,
    private readonly logger: Logger,
    private readonly fallbackApiKeys: Partial<Record<KeyedProvider, string>> = {}
  ) {}

  private resolveApiKey(userId: string, provider: KeyedProvider): string | null {
    const storedKey = this.database.decryptLlmProviderKey(userId, provider);
    if (storedKey) {
      return storedKey;
    }

    return this.fallbackApiKeys[provider] ?? null;
  }

  private async collectProviderModels(
    providerKeys: Array<{ provider: KeyedProvider; apiKey: string }>
  ): Promise<NormalizedModel[]> {
    const perProvider = await Promise.allSettled(
      providerKeys.map(async ({ provider, apiKey }): Promise<NormalizedModel[]> => {
        if (!this.registry.hasAdapter(provider)) {
          this.logger.warn({ provider }, "No adapter registered for provider");
          return [];
        }

        const adapter = this.registry.getAdapter(provider);
        try {
          return await adapter.listModels(apiKey);
        } catch (err) {
          this.logger.warn({ provider, err }, "Model listing failed for provider");
          return [];
        }
      })
    );

    return perProvider
      .filter((result): result is PromiseFulfilledResult<NormalizedModel[]> => result.status === "fulfilled")
      .flatMap((result) => result.value);
  }

  private sortModels(models: NormalizedModel[]): NormalizedModel[] {
    return models.sort((a, b) => {
      const pp = (PROVIDER_PRIORITY[a.provider] ?? 9) - (PROVIDER_PRIORITY[b.provider] ?? 9);
      return pp !== 0 ? pp : a.sortOrder - b.sortOrder;
    });
  }

  private async listGatewayModels(gatewayToken?: string): Promise<NormalizedModel[]> {
    if (!this.registry.hasAdapter("gateway")) {
      return [];
    }

    try {
      return await this.registry.getAdapter("gateway").listModels(gatewayToken ?? "");
    } catch (err) {
      this.logger.warn({ provider: "gateway", err }, "Model listing failed for provider");
      return [];
    }
  }

  private async listLocalModels(): Promise<NormalizedModel[]> {
    if (!this.registry.hasAdapter("local")) {
      return [];
    }

    try {
      return await this.registry.getAdapter("local").listModels("");
    } catch {
      return [];
    }
  }

  /**
   * Aggregate chat-capable models from all connected providers for this user.
   * Cloud providers use API keys from the DB; local Ollama does not need a key.
   * Providers that fail to respond are silently omitted (logged as warnings).
   */
  async listModels(userId: string, gatewayToken?: string): Promise<NormalizedModel[]> {
    const models: NormalizedModel[] = [];

    models.push(...(await this.listGatewayModels(gatewayToken)));

    const keyedProviders = new Set<KeyedProvider>();
    for (const keyRecord of this.database.listLlmProviderKeys(userId)) {
      if (keyRecord.provider === "gateway" || keyRecord.provider === "local") {
        continue;
      }
      keyedProviders.add(keyRecord.provider);
    }
    for (const [provider, apiKey] of Object.entries(this.fallbackApiKeys) as Array<[KeyedProvider, string | undefined]>) {
      if (apiKey) {
        keyedProviders.add(provider);
      }
    }

    models.push(
      ...(await this.collectProviderModels(
        Array.from(keyedProviders)
          .map((provider) => ({
            provider,
            apiKey: this.resolveApiKey(userId, provider),
          }))
          .filter((entry): entry is { provider: KeyedProvider; apiKey: string } => Boolean(entry.apiKey))
      ))
    );

    models.push(...(await this.listLocalModels()));

    return this.sortModels(models);
  }

  async listPublicModels(gatewayToken?: string): Promise<NormalizedModel[]> {
    const gatewayModels = await this.listGatewayModels(gatewayToken);
    if (gatewayModels.length > 0) {
      return this.sortModels(gatewayModels);
    }

    const localModels = await this.listLocalModels();
    if (localModels.length > 0) {
      return this.sortModels(localModels);
    }

    return [
      {
        id: "local:guest-preview",
        provider: "local",
        providerModelId: "guest-preview",
        displayName: "Guest Preview",
        supportsChat: true,
        supportsStreaming: false,
        supportsTools: true,
        supportsVision: false,
        status: "available",
        isDefaultCandidate: true,
        isPinned: true,
        sortOrder: 0,
      },
    ];
  }

  /**
   * Route a chat request to the correct provider based on the namespaced modelId.
   * Local models ("local:*") do not require a stored API key.
   * Throws LlmError for missing keys, unknown providers, or adapter failures.
   */
  async chat(userId: string, request: NormalizedChatRequest): Promise<NormalizedChatResponse> {
    const { provider, providerModelId } = LlmProviderRegistry.parseModelId(request.modelId);

    let apiKey: string;
    if (provider === "local" || provider === "gateway") {
      // Ollama does not require a stored key — use the registered adapter directly
      apiKey = "";
    } else {
      const stored = this.resolveApiKey(userId, provider);
      if (!stored) {
        throw new LlmError(
          `No ${provider} API key is configured for this account or the server default. Add it in Settings → LLM providers first if you want a personal key.`,
          { llmCode: "configuration_error", provider, statusCode: 422 }
        );
      }
      apiKey = stored;
    }

    const adapter = this.registry.getAdapter(provider);

    try {
      const resp = await adapter.chat(apiKey, {
        ...request,
        modelId: providerModelId, // pass raw provider model ID to the adapter
      });
      // Return the caller's original namespaced modelId, not the raw provider ID
      return { ...resp, modelId: request.modelId };
    } catch (err) {
      throw normalizeProviderError(err, provider, "Chat request failed");
    }
  }

  /**
   * Check connectivity for all connected providers, including local Ollama.
   * Uses adapter.healthCheck() when available, falls back to listing models.
   */
  async getProviderHealth(userId: string): Promise<ProviderHealth[]> {
    const keys = this.database.listLlmProviderKeys(userId);

    const results = await Promise.allSettled(
      keys.map(async (keyRecord): Promise<ProviderHealth> => {
        const apiKey = this.database.decryptLlmProviderKey(userId, keyRecord.provider);
        if (!apiKey) {
          return {
            provider: keyRecord.provider,
            status: "auth_error",
            error: "Failed to decrypt API key.",
            checkedAt: new Date().toISOString(),
          };
        }

        if (!this.registry.hasAdapter(keyRecord.provider)) {
          return {
            provider: keyRecord.provider,
            status: "unavailable",
            error: "No adapter registered.",
            checkedAt: new Date().toISOString(),
          };
        }

        const adapter = this.registry.getAdapter(keyRecord.provider);

        if (adapter.healthCheck) {
          return adapter.healthCheck(apiKey);
        }

        // Fallback: attempt model listing
        try {
          const models = await adapter.listModels(apiKey);
          return {
            provider: keyRecord.provider,
            status: models.length === 0 ? "no_models" : "healthy",
            checkedAt: new Date().toISOString(),
          };
        } catch (err) {
          const normalized = normalizeProviderError(err, keyRecord.provider, "Health check");
          return {
            provider: keyRecord.provider,
            status: normalized.llmCode === "authentication_error" ? "auth_error" : "unavailable",
            error: normalized.message,
            checkedAt: new Date().toISOString(),
          };
        }
      })
    );

    const healths: ProviderHealth[] = results
      .filter((r): r is PromiseFulfilledResult<ProviderHealth> => r.status === "fulfilled")
      .map((r) => r.value);

    if (this.registry.hasAdapter("gateway")) {
      const gatewayAdapter = this.registry.getAdapter("gateway");
      if (gatewayAdapter.healthCheck) {
        const gatewayHealth = await gatewayAdapter.healthCheck("").catch(
          (): ProviderHealth => ({
            provider: "gateway",
            status: "unavailable",
            error: "Health check failed",
            checkedAt: new Date().toISOString(),
          })
        );
        healths.push(gatewayHealth);
      }
    }

    // Always check local Ollama health (no DB key needed)
    if (this.registry.hasAdapter("local")) {
      const localAdapter = this.registry.getAdapter("local");
      if (localAdapter.healthCheck) {
        const localHealth = await localAdapter.healthCheck("").catch((): ProviderHealth => ({
          provider: "local",
          status: "unavailable",
          error: "Health check failed",
          checkedAt: new Date().toISOString(),
        }));
        healths.push(localHealth);
      }
    }

    return healths;
  }
}
