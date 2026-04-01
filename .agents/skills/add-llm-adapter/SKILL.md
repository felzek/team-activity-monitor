---
name: add-llm-adapter
description: Checklist for adding a new LLM provider adapter. Covers types, adapter class, registry registration, and tests.
user-invocable: true
allowed-tools: Read, Edit, Bash
---

Add a new LLM provider to the multi-provider LLM service.

## Steps

### 1. Read the existing adapter structure

```bash
# understand the interface before writing
```

Read `src/llm/types.ts` for `NormalizedChatRequest`, `NormalizedChatResponse`, `NormalizedChatMessage`, `ToolDefinition`, `ToolCall`.
Read `src/llm/adapters/anthropic.ts` as the reference implementation for tool use support.

### 2. Create `src/llm/adapters/<provider>.ts`

Implement and export a class that extends the base adapter:

```typescript
import type { NormalizedChatRequest, NormalizedChatResponse } from "../types.js";

export class YourProviderAdapter {
  constructor(private apiKey: string, private model: string) {}

  async chat(request: NormalizedChatRequest): Promise<NormalizedChatResponse> {
    // 1. Translate NormalizedChatMessage[] → provider message format
    // 2. POST to provider API
    // 3. Translate provider response → NormalizedChatResponse
    // 4. If tools requested: detect tool-call stop condition, extract ToolCall[]
    return {
      content: responseText,        // null if tool calls returned
      toolCalls: toolCalls ?? [],   // empty array if final answer
      usage: { promptTokens, completionTokens },
    };
  }
}
```

**Tool use checklist:**
- If `request.tools` is non-empty, include tool definitions in the API call
- Detect tool-call finish condition (provider-specific stop reason / finish_reason)
- Map provider tool call format → `ToolCall { id, name, arguments: Record<string, unknown> }`
- Map `role: "tool"` messages → provider's tool result format
- Return `content: null, toolCalls: [...]` when LLM wants to call tools
- Return `content: "...", toolCalls: []` when LLM returns a final answer

### 3. Register in `src/llm/service.ts` (or registry file)

Read the file first to understand the registration pattern, then add:
```typescript
case "yourprovider":
  return new YourProviderAdapter(config.yourProviderApiKey, modelId);
```

### 4. Add config validation in `src/config.ts`

Add the API key to the Zod schema:
```typescript
YOUR_PROVIDER_API_KEY: z.string().optional(),
```

### 5. Update dashboard / model list

If the provider exposes a model list endpoint, add a fetcher so the UI model selector populates. Check `src/routes/` for existing model-list routes.

### 6. Write a test

```typescript
// In tests/llm-adapters.test.ts
it("YourProvider chat returns normalized response", async () => {
  // mock fetch for the API call
  // assert content or toolCalls shape
});
```

### 7. Typecheck + test

```bash
npm run typecheck && npm test
```

## Key facts

- `NormalizedChatMessage.role` can be `"user"`, `"assistant"`, `"system"`, or `"tool"`
- `role: "tool"` messages have `toolCallId` and `toolName` — needed for result routing
- `NormalizedChatMessage.toolCalls` on an `"assistant"` message = what the LLM requested
- All local imports use `.js` extensions (NodeNext resolution)
- Temperature for factual/grounded responses: 0.1 (see `chat-pipeline.ts`)
- Never throw from `chat()` — callers expect a response or a propagated AppError
