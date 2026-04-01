/**
 * Artifact API routes.
 *
 * All routes require authentication. Artifacts are scoped to the user's
 * current organization via `requireOrganization` middleware that sets
 * `req.session.currentOrganizationId`.
 */

import express from "express";
import type { Logger } from "pino";
import { z } from "zod";

import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";
import { requireAuth, requireCsrf, requireOrganization } from "../auth.js";
import { ArtifactService } from "../lib/artifacts/service.js";
import { AppError } from "../lib/errors.js";
import type { ArtifactKind, ArtifactSpec } from "../lib/artifacts/types.js";

const createArtifactSchema = z.object({
  kind: z.enum([
    "google_doc", "google_sheet", "google_slides",
    "chart", "xlsx_export", "pptx_export", "pdf_export"
  ]),
  title: z.string().min(1).max(500),
  spec: z.record(z.string(), z.unknown()),
  conversationId: z.string().optional(),
  messageId: z.string().optional(),
  driveFolderId: z.string().optional()
});

const shareSchema = z.object({
  email: z.string().email(),
  role: z.enum(["reader", "writer", "commenter"])
});

const exportSchema = z.object({
  format: z.enum(["xlsx", "pptx", "pdf", "docx"])
});

export function createArtifactsRouter(
  config: AppConfig,
  database: AppDatabase,
  logger: Logger
): express.Router {
  const router = express.Router();
  const service = new ArtifactService(database, config, logger);

  // All routes require auth + org context
  router.use(requireAuth);
  router.use(requireOrganization(database));

  // ── GET /google/picker-config ─────────────────────────────────────────
  // Must be registered BEFORE the `/:id` param route to avoid conflict.
  router.get("/google/picker-config", (req, res) => {
    const userId = req.session.userId!;
    const tokenData = database.getUserProviderToken(userId, "google");

    res.json({
      clientId: config.googleOAuthClientId ?? null,
      apiKey: config.googlePickerApiKey ?? null,
      hasToken: Boolean(tokenData),
      scopes: config.googleOAuthScope.join(" ")
    });
  });

  // ── GET /conversation/:conversationId ─────────────────────────────────
  router.get("/conversation/:conversationId", (req, res, next) => {
    try {
      const artifacts = service.listConversationArtifacts(req.params.conversationId as string);
      res.json({ artifacts });
    } catch (err) {
      next(err);
    }
  });

  // ── POST / — Create an artifact ──────────────────────────────────────
  router.post("/", requireCsrf, async (req, res, next) => {
    try {
      const userId = req.session.userId!;
      const organizationId = req.session.currentOrganizationId!;
      const body = createArtifactSchema.parse(req.body);

      const metadata = await service.createArtifact(userId, organizationId, {
        kind: body.kind as ArtifactKind,
        title: body.title,
        spec: body.spec as unknown as ArtifactSpec,
        conversationId: body.conversationId,
        messageId: body.messageId,
        driveFolderId: body.driveFolderId
      });

      res.status(201).json(metadata);
    } catch (err) {
      next(err);
    }
  });

  // ── GET / — List artifacts ────────────────────────────────────────────
  router.get("/", (req, res, next) => {
    try {
      const userId = req.session.userId!;
      const organizationId = req.session.currentOrganizationId!;
      const conversationId = typeof req.query.conversationId === "string"
        ? req.query.conversationId
        : undefined;
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const offset = Number(req.query.offset) || 0;

      const result = database.listArtifacts({
        userId,
        organizationId,
        conversationId,
        limit,
        offset
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // ── GET /:id — Get artifact status ────────────────────────────────────
  router.get("/:id", (req, res, next) => {
    try {
      const userId = req.session.userId!;
      const metadata = service.getArtifactStatus(req.params.id as string, userId);
      if (!metadata) {
        throw new AppError("Artifact not found.", { code: "NOT_FOUND", statusCode: 404 });
      }
      res.json(metadata);
    } catch (err) {
      next(err);
    }
  });

  // ── POST /:id/retry — Retry a failed artifact ────────────────────────
  router.post("/:id/retry", requireCsrf, async (req, res, next) => {
    try {
      const userId = req.session.userId!;
      const metadata = await service.retryArtifact(req.params.id as string, userId);
      res.json(metadata);
    } catch (err) {
      next(err);
    }
  });

  // ── POST /:id/share — Share an artifact ───────────────────────────────
  router.post("/:id/share", requireCsrf, async (req, res, next) => {
    try {
      const userId = req.session.userId!;
      const body = shareSchema.parse(req.body);
      await service.shareArtifact(req.params.id as string, userId, body);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // ── POST /:id/export — Export to Office format ────────────────────────
  router.post("/:id/export", requireCsrf, async (req, res, next) => {
    try {
      const userId = req.session.userId!;
      const organizationId = req.session.currentOrganizationId!;
      const body = exportSchema.parse(req.body);
      const metadata = await service.exportArtifact(req.params.id as string, userId, organizationId, body.format);
      res.status(201).json(metadata);
    } catch (err) {
      next(err);
    }
  });

  // ── POST /:id/upload-chart — Upload a chart image to Drive ────────────
  router.post("/:id/upload-chart", requireCsrf, async (req, res, next) => {
    try {
      const userId = req.session.userId!;
      const contentType = req.headers["content-type"] ?? "image/png";

      // Read raw body
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const buffer = Buffer.concat(chunks);

      if (buffer.length === 0) {
        throw new AppError("No image data provided.", { code: "MISSING_BODY", statusCode: 400 });
      }

      const metadata = await service.uploadChartImage(req.params.id as string, userId, buffer, contentType);
      res.json(metadata);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
