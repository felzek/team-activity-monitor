import type { LlmProvider } from "../types/auth.js";
import { LlmError } from "./errors.js";
import type { LlmProviderAdapter } from "./types.js";

export class LlmProviderRegistry {
  private readonly adapters = new Map<LlmProvider, LlmProviderAdapter>();

  register(adapter: LlmProviderAdapter): this {
    this.adapters.set(adapter.provider, adapter);
    return this;
  }

  getAdapter(provider: LlmProvider): LlmProviderAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new LlmError(`No adapter registered for provider: ${provider}`, {
        llmCode: "unknown_provider_error",
        statusCode: 500,
      });
    }
    return adapter;
  }

  hasAdapter(provider: LlmProvider): boolean {
    return this.adapters.has(provider);
  }

  allAdapters(): LlmProviderAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Parse a namespaced model ID like "openai:gpt-4o" into its components.
   * Throws LlmError for unrecognized formats or unknown providers.
   */
  static parseModelId(modelId: string): { provider: LlmProvider; providerModelId: string } {
    const colonIndex = modelId.indexOf(":");
    if (colonIndex === -1) {
      throw new LlmError(
        `Invalid model ID "${modelId}". Expected format: "provider:model-id".`,
        { llmCode: "invalid_model", statusCode: 400 }
      );
    }
    const provider = modelId.slice(0, colonIndex) as LlmProvider;
    const providerModelId = modelId.slice(colonIndex + 1);

    const validProviders: LlmProvider[] = ["openai", "claude", "gemini", "local"];
    if (!validProviders.includes(provider)) {
      throw new LlmError(
        `Unknown provider "${provider}". Valid providers: ${validProviders.join(", ")}.`,
        { llmCode: "invalid_model", statusCode: 400 }
      );
    }

    return { provider, providerModelId };
  }

  static buildModelId(provider: LlmProvider, providerModelId: string): string {
    return `${provider}:${providerModelId}`;
  }
}
