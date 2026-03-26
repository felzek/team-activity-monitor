import type { Logger } from "pino";

import type { AppDatabase } from "../db.js";
import { LlmError, normalizeProviderError } from "./errors.js";
import { LlmProviderRegistry } from "./registry.js";
import type {
  NormalizedChatRequest,
  NormalizedChatResponse,
  NormalizedModel,
  ProviderHealth,
} from "./types.js";

/** Provider display priority — lower = shown first in model list */
const PROVIDER_PRIORITY: Record<string, number> = { claude: 0, openai: 1, gemini: 2 };

export class LlmService {
  constructor(
    private readonly registry: LlmProviderRegistry,
    private readonly database: AppDatabase,
    private readonly logger: Logger
  ) {}

  /**
   * Aggregate chat-capable models from all connected providers for this user.
   * Providers that fail to respond are silently omitted (logged as warnings).
   */
  async listModels(userId: string): Promise<NormalizedModel[]> {
    const keys = this.database.listLlmProviderKeys(userId);

    const perProvider = await Promise.allSettled(
      keys.map(async (keyRecord): Promise<NormalizedModel[]> => {
        const apiKey = this.database.decryptLlmProviderKey(userId, keyRecord.provider);
        if (!apiKey) return [];

        if (!this.registry.hasAdapter(keyRecord.provider)) {
          this.logger.warn({ provider: keyRecord.provider }, "No adapter registered for provider");
          return [];
        }

        const adapter = this.registry.getAdapter(keyRecord.provider);
        try {
          return await adapter.listModels(apiKey);
        } catch (err) {
          this.logger.warn(
            { provider: keyRecord.provider, err },
            "Model listing failed for provider"
          );
          return [];
        }
      })
    );

    const models: NormalizedModel[] = [];
    for (const result of perProvider) {
      if (result.status === "fulfilled") models.push(...result.value);
    }

    return models.sort((a, b) => {
      const pp = (PROVIDER_PRIORITY[a.provider] ?? 9) - (PROVIDER_PRIORITY[b.provider] ?? 9);
      return pp !== 0 ? pp : a.sortOrder - b.sortOrder;
    });
  }

  /**
   * Route a chat request to the correct provider based on the namespaced modelId.
   * Throws LlmError for missing keys, unknown providers, or adapter failures.
   */
  async chat(userId: string, request: NormalizedChatRequest): Promise<NormalizedChatResponse> {
    const { provider, providerModelId } = LlmProviderRegistry.parseModelId(request.modelId);

    const apiKey = this.database.decryptLlmProviderKey(userId, provider);
    if (!apiKey) {
      throw new LlmError(`No ${provider} API key saved yet. Add it in Settings → LLM providers first (paste and Save key).`, {
        llmCode: "configuration_error",
        provider,
        statusCode: 422,
      });
    }

    const adapter = this.registry.getAdapter(provider);

    try {
      const resp = await adapter.chat(apiKey, {
        ...request,
        modelId: providerModelId, // pass raw provider ID to the adapter
      });
      // Return the caller's original namespaced modelId, not the raw provider ID
      return { ...resp, modelId: request.modelId };
    } catch (err) {
      throw normalizeProviderError(err, provider, "Chat request failed");
    }
  }

  /**
   * Check connectivity for all connected providers.
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

    return results
      .filter((r): r is PromiseFulfilledResult<ProviderHealth> => r.status === "fulfilled")
      .map((r) => r.value);
  }
}
