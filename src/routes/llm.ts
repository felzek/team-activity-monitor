import express from "express";
import type { Logger } from "pino";
import { z } from "zod";

import { requireAuth, requireCsrf } from "../auth.js";
import { AppError } from "../lib/errors.js";
import type { LlmService } from "../llm/service.js";

const chatRequestSchema = z.object({
  modelId: z.string().min(1, "modelId is required"),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().min(1, "message content cannot be empty"),
      })
    )
    .min(1, "At least one message is required"),
  conversationId: z.string().optional(),
  stream: z.boolean().optional().default(false),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive().max(32_768).optional(),
});

export function createLlmRouter(service: LlmService, _logger: Logger): express.Router {
  const router = express.Router();

  /**
   * GET /api/llm/models
   * Returns all chat-capable models from the user's connected providers,
   * sorted by provider priority then model sort order.
   */
  router.get("/models", requireAuth, async (request, response) => {
    const userId = request.session.userId!;
    const models = await service.listModels(userId);
    response.json({ models });
  });

  /**
   * POST /api/llm/chat
   * Sends a chat request to the provider determined by the modelId prefix.
   * Body: { modelId, messages, [temperature], [maxOutputTokens] }
   */
  router.post("/chat", requireAuth, requireCsrf, async (request, response) => {
    const userId = request.session.userId!;

    const parsed = chatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues.map((i) => i.message).join("; "),
        { code: "VALIDATION_ERROR", statusCode: 400 }
      );
    }

    const chatResponse = await service.chat(userId, parsed.data);
    response.json(chatResponse);
  });

  /**
   * GET /api/llm/providers
   * Returns connectivity health for each of the user's connected providers.
   */
  router.get("/providers", requireAuth, async (request, response) => {
    const userId = request.session.userId!;
    const providers = await service.getProviderHealth(userId);
    response.json({ providers });
  });

  return router;
}
