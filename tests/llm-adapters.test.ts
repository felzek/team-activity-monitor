import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnthropicAdapter } from "../src/llm/adapters/anthropic.js";
import { GeminiAdapter } from "../src/llm/adapters/gemini.js";
import { OpenAiAdapter } from "../src/llm/adapters/openai.js";
import { LlmError } from "../src/llm/errors.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const OPENAI_MODELS_FIXTURE = {
  data: [
    { id: "gpt-4o", created: 1700000000 },
    { id: "gpt-4o-mini", created: 1700000001 },
    { id: "o1", created: 1700000002 },
    { id: "text-embedding-3-small", created: 1700000003 }, // should be excluded
    { id: "whisper-1", created: 1700000004 },               // should be excluded
    { id: "dall-e-3", created: 1700000005 },                // should be excluded
    { id: "gpt-3.5-turbo", created: 1700000006 },
  ],
};

const OPENAI_CHAT_RESPONSE_FIXTURE = {
  model: "gpt-4o-2024-11-20",
  status: "completed",
  output: [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Hello from OpenAI!" }],
    },
  ],
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
};

const ANTHROPIC_MODELS_FIXTURE = {
  data: [
    { id: "claude-opus-4-6-20250514", display_name: "Claude Opus 4.6", type: "model", created_at: "2025-01-01T00:00:00Z" },
    { id: "claude-sonnet-4-6-20251022", display_name: "Claude Sonnet 4.6", type: "model", created_at: "2025-01-01T00:00:00Z" },
    { id: "claude-haiku-4-5-20251001", display_name: "Claude Haiku 4.5", type: "model", created_at: "2025-01-01T00:00:00Z" },
  ],
};

const ANTHROPIC_CHAT_RESPONSE_FIXTURE = {
  id: "msg_abc123",
  type: "message",
  role: "assistant",
  content: [{ type: "text", text: "Hello from Anthropic!" }],
  model: "claude-opus-4-6-20250514",
  stop_reason: "end_turn",
  usage: { input_tokens: 12, output_tokens: 8 },
};

const GEMINI_MODELS_FIXTURE = {
  models: [
    {
      name: "models/gemini-2.0-flash-001",
      displayName: "Gemini 2.0 Flash",
      supportedGenerationMethods: ["generateContent", "countTokens", "streamGenerateContent"],
    },
    {
      name: "models/gemini-2.5-pro-preview-001",
      displayName: "Gemini 2.5 Pro Preview",
      supportedGenerationMethods: ["generateContent", "countTokens"],
    },
    {
      name: "models/text-embedding-004",       // should be excluded
      displayName: "Text Embedding 004",
      supportedGenerationMethods: ["embedContent"],
    },
  ],
};

const GEMINI_CHAT_RESPONSE_FIXTURE = {
  candidates: [
    {
      content: { parts: [{ text: "Hello from Gemini!" }], role: "model" },
      finishReason: "STOP",
    },
  ],
  usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 6, totalTokenCount: 14 },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFetch(responses: Array<{ ok: boolean; status: number; body: unknown }>) {
  let call = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    const r = responses[call++ % responses.length]!;
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  });
}

function ok(body: unknown) {
  return { ok: true, status: 200, body };
}

function fail(status: number, message: string) {
  return { ok: false, status, body: { error: { message } } };
}

// ── OpenAI adapter ────────────────────────────────────────────────────────────

describe("OpenAiAdapter", () => {
  let adapter: OpenAiAdapter;

  beforeEach(() => {
    adapter = new OpenAiAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists only chat-capable models", async () => {
    mockFetch([ok(OPENAI_MODELS_FIXTURE)]);
    const models = await adapter.listModels("sk-test");
    const ids = models.map((m) => m.providerModelId);
    expect(ids).toContain("gpt-4o");
    expect(ids).toContain("gpt-4o-mini");
    expect(ids).toContain("o1");
    expect(ids).toContain("gpt-3.5-turbo");
    // Excluded models must not appear
    expect(ids).not.toContain("text-embedding-3-small");
    expect(ids).not.toContain("whisper-1");
    expect(ids).not.toContain("dall-e-3");
  });

  it("returns namespaced model IDs", async () => {
    mockFetch([ok(OPENAI_MODELS_FIXTURE)]);
    const models = await adapter.listModels("sk-test");
    expect(models[0].id).toMatch(/^openai:/);
  });

  it("marks gpt-4o as default candidate", async () => {
    mockFetch([ok(OPENAI_MODELS_FIXTURE)]);
    const models = await adapter.listModels("sk-test");
    const gpt4o = models.find((m) => m.providerModelId === "gpt-4o");
    expect(gpt4o?.isDefaultCandidate).toBe(true);
  });

  it("marks o1 as extended reasoning tier", async () => {
    mockFetch([ok(OPENAI_MODELS_FIXTURE)]);
    const models = await adapter.listModels("sk-test");
    const o1 = models.find((m) => m.providerModelId === "o1");
    expect(o1?.reasoningTier).toBe("extended");
  });

  it("sends chat to Responses API and normalizes response", async () => {
    mockFetch([ok(OPENAI_CHAT_RESPONSE_FIXTURE)]);
    const resp = await adapter.chat("sk-test", {
      modelId: "gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(resp.provider).toBe("openai");
    expect(resp.message.role).toBe("assistant");
    expect(resp.message.content).toBe("Hello from OpenAI!");
    expect(resp.usage.inputTokens).toBe(10);
    expect(resp.usage.outputTokens).toBe(5);
    expect(resp.usage.totalTokens).toBe(15);
    expect(resp.finishReason).toBe("stop");
    expect(resp.error).toBeNull();
  });

  it("extracts system message as instructions field", async () => {
    const fetchSpy = mockFetch([ok(OPENAI_CHAT_RESPONSE_FIXTURE)]);
    await adapter.chat("sk-test", {
      modelId: "gpt-4o",
      messages: [
        { role: "system", content: "You are a pirate." },
        { role: "user", content: "Hello" },
      ],
    });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.instructions).toBe("You are a pirate.");
    // System message must NOT appear in input array
    expect(body.input.every((m: { role: string }) => m.role !== "system")).toBe(true);
  });

  it("throws LlmError with authentication_error code on 401", async () => {
    mockFetch([fail(401, "Incorrect API key provided")]);
    await expect(adapter.listModels("bad-key")).rejects.toMatchObject({
      llmCode: "authentication_error",
      provider: "openai",
    });
  });

  it("throws LlmError with rate_limit_error code on 429", async () => {
    mockFetch([fail(429, "Rate limit exceeded")]);
    await expect(adapter.chat("sk-test", {
      modelId: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    })).rejects.toMatchObject({
      llmCode: "rate_limit_error",
      retryable: true,
    });
  });
});

// ── Anthropic adapter ─────────────────────────────────────────────────────────

describe("AnthropicAdapter", () => {
  let adapter: AnthropicAdapter;

  beforeEach(() => {
    adapter = new AnthropicAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists models and preserves API display names", async () => {
    mockFetch([ok(ANTHROPIC_MODELS_FIXTURE)]);
    const models = await adapter.listModels("sk-ant-test");
    expect(models).toHaveLength(3);
    const opus = models.find((m) => m.providerModelId.includes("opus"));
    expect(opus?.displayName).toBe("Claude Opus 4.6");
  });

  it("returns namespaced model IDs with claude: prefix", async () => {
    mockFetch([ok(ANTHROPIC_MODELS_FIXTURE)]);
    const models = await adapter.listModels("sk-ant-test");
    expect(models.every((m) => m.id.startsWith("claude:"))).toBe(true);
  });

  it("marks haiku as fast latency tier", async () => {
    mockFetch([ok(ANTHROPIC_MODELS_FIXTURE)]);
    const models = await adapter.listModels("sk-ant-test");
    const haiku = models.find((m) => m.providerModelId.includes("haiku"));
    expect(haiku?.latencyTier).toBe("fast");
  });

  it("sends system message via top-level system field", async () => {
    const fetchSpy = mockFetch([ok(ANTHROPIC_CHAT_RESPONSE_FIXTURE)]);
    await adapter.chat("sk-ant-test", {
      modelId: "claude-opus-4-6-20250514",
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "What is 2+2?" },
      ],
    });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.system).toBe("Be brief.");
    expect(body.messages.every((m: { role: string }) => m.role !== "system")).toBe(true);
  });

  it("normalizes Messages API response correctly", async () => {
    mockFetch([ok(ANTHROPIC_CHAT_RESPONSE_FIXTURE)]);
    const resp = await adapter.chat("sk-ant-test", {
      modelId: "claude-opus-4-6-20250514",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(resp.provider).toBe("claude");
    expect(resp.message.content).toBe("Hello from Anthropic!");
    expect(resp.usage.inputTokens).toBe(12);
    expect(resp.usage.outputTokens).toBe(8);
    expect(resp.usage.totalTokens).toBe(20);
    expect(resp.finishReason).toBe("end_turn");
    expect(resp.error).toBeNull();
  });

  it("throws LlmError with authentication_error on 401", async () => {
    mockFetch([fail(401, "Invalid x-api-key")]);
    await expect(adapter.listModels("bad-key")).rejects.toMatchObject({
      llmCode: "authentication_error",
      provider: "claude",
    });
  });
});

// ── Gemini adapter ────────────────────────────────────────────────────────────

describe("GeminiAdapter", () => {
  let adapter: GeminiAdapter;

  beforeEach(() => {
    adapter = new GeminiAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists only generateContent-capable models", async () => {
    mockFetch([ok(GEMINI_MODELS_FIXTURE)]);
    const models = await adapter.listModels("AIza-test");
    const names = models.map((m) => m.providerModelId);
    expect(names).toContain("models/gemini-2.0-flash-001");
    expect(names).toContain("models/gemini-2.5-pro-preview-001");
    expect(names).not.toContain("models/text-embedding-004");
  });

  it("uses API displayName when available", async () => {
    mockFetch([ok(GEMINI_MODELS_FIXTURE)]);
    const models = await adapter.listModels("AIza-test");
    const flash = models.find((m) => m.providerModelId === "models/gemini-2.0-flash-001");
    expect(flash?.displayName).toBe("Gemini 2.0 Flash");
  });

  it("marks flash models as fast latency tier", async () => {
    mockFetch([ok(GEMINI_MODELS_FIXTURE)]);
    const models = await adapter.listModels("AIza-test");
    const flash = models.find((m) => m.providerModelId.includes("flash"));
    expect(flash?.latencyTier).toBe("fast");
  });

  it("maps assistant role to Gemini model role in request", async () => {
    const fetchSpy = mockFetch([ok(GEMINI_CHAT_RESPONSE_FIXTURE)]);
    await adapter.chat("AIza-test", {
      modelId: "models/gemini-2.0-flash-001",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!" },
        { role: "user", content: "How are you?" },
      ],
    });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.contents[1].role).toBe("model"); // "assistant" → "model"
  });

  it("sends system prompt as systemInstruction field", async () => {
    const fetchSpy = mockFetch([ok(GEMINI_CHAT_RESPONSE_FIXTURE)]);
    await adapter.chat("AIza-test", {
      modelId: "models/gemini-2.0-flash-001",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello" },
      ],
    });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.systemInstruction.parts[0].text).toBe("Be concise.");
    expect(body.contents.every((c: { role: string }) => c.role !== "system")).toBe(true);
  });

  it("normalizes generateContent response correctly", async () => {
    mockFetch([ok(GEMINI_CHAT_RESPONSE_FIXTURE)]);
    const resp = await adapter.chat("AIza-test", {
      modelId: "models/gemini-2.0-flash-001",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(resp.provider).toBe("gemini");
    expect(resp.message.content).toBe("Hello from Gemini!");
    expect(resp.usage.inputTokens).toBe(8);
    expect(resp.usage.outputTokens).toBe(6);
    expect(resp.usage.totalTokens).toBe(14);
    expect(resp.finishReason).toBe("stop");
    expect(resp.error).toBeNull();
  });

  it("throws LlmError with authentication_error on 403", async () => {
    mockFetch([fail(403, "API key not valid")]);
    await expect(adapter.listModels("bad-key")).rejects.toMatchObject({
      llmCode: "authentication_error",
      provider: "gemini",
    });
  });
});

// ── LlmError normalization ────────────────────────────────────────────────────

describe("LlmError", () => {
  it("is an instance of Error", () => {
    const err = new LlmError("Test", { llmCode: "authentication_error", provider: "openai" });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LlmError);
  });

  it("carries llmCode and provider", () => {
    const err = new LlmError("Bad key", { llmCode: "authentication_error", provider: "claude" });
    expect(err.llmCode).toBe("authentication_error");
    expect(err.provider).toBe("claude");
    expect(err.statusCode).toBe(401);
    expect(err.retryable).toBe(false);
  });

  it("marks rate limit errors as retryable", () => {
    const err = new LlmError("Too many requests", {
      llmCode: "rate_limit_error",
      provider: "gemini",
      retryable: true,
    });
    expect(err.retryable).toBe(true);
    expect(err.statusCode).toBe(429);
  });
});
