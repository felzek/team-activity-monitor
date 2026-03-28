import express from "express";
import type { Logger } from "pino";
import { z } from "zod";

import { requireAuth, requireOrganization } from "../auth.js";
import type { AppDatabase } from "../db.js";

export function createConversationsRouter(
  database: AppDatabase,
  _logger: Logger,
): express.Router {
  const router = express.Router();

  // ── List conversations ────────────────────────────────────────────────
  router.get(
    "/api/v1/conversations",
    requireAuth,
    requireOrganization(database),
    (request, response) => {
      const { userId, currentOrganizationId } = request.session;
      if (!userId || !currentOrganizationId) {
        response.status(401).json({ error: "Not authenticated" });
        return;
      }

      const page = Math.max(1, Number(request.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 30));
      const archived = request.query.archived === "true";
      const pinnedOnly = request.query.pinned === "true";
      const projectId = typeof request.query.projectId === "string" ? request.query.projectId : undefined;

      const result = database.listConversations({
        userId,
        organizationId: currentOrganizationId,
        archived,
        pinnedOnly,
        projectId: projectId === "none" ? null : projectId,
        limit,
        offset: (page - 1) * limit,
      });

      response.json({
        conversations: result.conversations,
        total: result.total,
        page,
        hasMore: page * limit < result.total,
      });
    },
  );

  // ── Search conversations ──────────────────────────────────────────────
  router.get(
    "/api/v1/conversations/search",
    requireAuth,
    requireOrganization(database),
    (request, response) => {
      const { userId, currentOrganizationId } = request.session;
      if (!userId || !currentOrganizationId) {
        response.status(401).json({ error: "Not authenticated" });
        return;
      }

      const q = typeof request.query.q === "string" ? request.query.q.trim() : "";
      if (!q) {
        response.json({ results: [] });
        return;
      }

      const results = database.searchConversations({
        userId,
        organizationId: currentOrganizationId,
        query: q,
        limit: 20,
      });

      response.json({ results });
    },
  );

  // ── Create conversation ───────────────────────────────────────────────
  router.post(
    "/api/v1/conversations",
    requireAuth,
    requireOrganization(database),
    (request, response) => {
      const { userId, currentOrganizationId } = request.session;
      if (!userId || !currentOrganizationId) {
        response.status(401).json({ error: "Not authenticated" });
        return;
      }

      const schema = z.object({
        title: z.string().min(1).max(200).optional(),
        projectId: z.string().optional(),
      });

      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: "Invalid request", details: parsed.error.issues });
        return;
      }

      const conversation = database.createConversation({
        organizationId: currentOrganizationId,
        userId,
        title: parsed.data.title,
        projectId: parsed.data.projectId,
      });

      response.status(201).json(conversation);
    },
  );

  // ── Get single conversation ───────────────────────────────────────────
  router.get(
    "/api/v1/conversations/:id",
    requireAuth,
    requireOrganization(database),
    (request, response) => {
      const { userId } = request.session;
      if (!userId) {
        response.status(401).json({ error: "Not authenticated" });
        return;
      }

      const id = request.params.id as string;
      const conversation = database.getConversation(id, userId);
      if (!conversation) {
        response.status(404).json({ error: "Conversation not found" });
        return;
      }

      response.json(conversation);
    },
  );

  // ── Update conversation ───────────────────────────────────────────────
  router.patch(
    "/api/v1/conversations/:id",
    requireAuth,
    requireOrganization(database),
    (request, response) => {
      const { userId } = request.session;
      if (!userId) {
        response.status(401).json({ error: "Not authenticated" });
        return;
      }

      const schema = z.object({
        title: z.string().min(1).max(200).optional(),
        pinned: z.boolean().optional(),
        archived: z.boolean().optional(),
        projectId: z.string().nullable().optional(),
      });

      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: "Invalid request", details: parsed.error.issues });
        return;
      }

      const id = request.params.id as string;
      const updated = database.updateConversation(id, userId, parsed.data);
      if (!updated) {
        response.status(404).json({ error: "Conversation not found" });
        return;
      }

      const conversation = database.getConversation(id, userId);
      response.json(conversation);
    },
  );

  // ── Delete conversation ───────────────────────────────────────────────
  router.delete(
    "/api/v1/conversations/:id",
    requireAuth,
    requireOrganization(database),
    (request, response) => {
      const { userId } = request.session;
      if (!userId) {
        response.status(401).json({ error: "Not authenticated" });
        return;
      }

      const id = request.params.id as string;
      const deleted = database.deleteConversation(id, userId);
      if (!deleted) {
        response.status(404).json({ error: "Conversation not found" });
        return;
      }

      response.status(204).send();
    },
  );

  // ── List messages for a conversation ──────────────────────────────────
  router.get(
    "/api/v1/conversations/:id/messages",
    requireAuth,
    requireOrganization(database),
    (request, response) => {
      const { userId } = request.session;
      if (!userId) {
        response.status(401).json({ error: "Not authenticated" });
        return;
      }

      const id = request.params.id as string;
      const limit = Math.min(200, Math.max(1, Number(request.query.limit) || 100));
      const before = typeof request.query.before === "string" ? request.query.before : undefined;

      const result = database.listMessages(id, userId, { limit, before });
      response.json(result);
    },
  );

  // ── Projects CRUD ─────────────────────────────────────────────────────

  router.get(
    "/api/v1/projects",
    requireAuth,
    requireOrganization(database),
    (request, response) => {
      const { currentOrganizationId } = request.session;
      if (!currentOrganizationId) {
        response.status(401).json({ error: "Not authenticated" });
        return;
      }

      const projects = database.listProjects(currentOrganizationId);
      response.json({ projects });
    },
  );

  router.post(
    "/api/v1/projects",
    requireAuth,
    requireOrganization(database),
    (request, response) => {
      const { currentOrganizationId } = request.session;
      if (!currentOrganizationId) {
        response.status(401).json({ error: "Not authenticated" });
        return;
      }

      const schema = z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        instructions: z.string().max(2000).optional(),
        icon: z.string().max(10).optional(),
      });

      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: "Invalid request", details: parsed.error.issues });
        return;
      }

      const project = database.createProject({
        organizationId: currentOrganizationId,
        ...parsed.data,
      });

      response.status(201).json(project);
    },
  );

  router.patch(
    "/api/v1/projects/:id",
    requireAuth,
    requireOrganization(database),
    (request, response) => {
      const { currentOrganizationId } = request.session;
      if (!currentOrganizationId) {
        response.status(401).json({ error: "Not authenticated" });
        return;
      }

      const schema = z.object({
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        instructions: z.string().max(2000).optional(),
        icon: z.string().max(10).optional(),
        archived: z.boolean().optional(),
      });

      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: "Invalid request", details: parsed.error.issues });
        return;
      }

      const id = request.params.id as string;
      const updated = database.updateProject(id, currentOrganizationId, parsed.data);
      if (!updated) {
        response.status(404).json({ error: "Project not found" });
        return;
      }

      response.json({ ok: true });
    },
  );

  router.delete(
    "/api/v1/projects/:id",
    requireAuth,
    requireOrganization(database),
    (request, response) => {
      const { currentOrganizationId } = request.session;
      if (!currentOrganizationId) {
        response.status(401).json({ error: "Not authenticated" });
        return;
      }

      const id = request.params.id as string;
      const deleted = database.deleteProject(id, currentOrganizationId);
      if (!deleted) {
        response.status(404).json({ error: "Project not found" });
        return;
      }

      response.status(204).send();
    },
  );

  return router;
}
