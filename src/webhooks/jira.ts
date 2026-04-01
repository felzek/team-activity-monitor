/**
 * Jira webhook handler.
 *
 * Jira Cloud webhooks are simpler than GitHub's: the secret is typically
 * embedded as a token in the URL query string (no HMAC signing).
 * We compare the incoming token against the stored secret with constant-time
 * comparison to prevent timing attacks.
 *
 * Supported events:
 *  - jira:issue_created  → invalidate jira:issues:{assigneeAccountId}
 *  - jira:issue_updated  → invalidate jira:issues:{assigneeAccountId}
 *  - jira:issue_deleted  → invalidate jira:issues:{assigneeAccountId}
 *  - jira:sprint_started / jira:sprint_closed → invalidate all jira issue caches for the org
 *
 * Jira delivers webhooks to a public HTTPS endpoint. Ensure APP_BASE_URL is
 * correctly set and the server is reachable from the internet (or via a tunnel
 * during development).
 */

import { timingSafeEqual } from "node:crypto";

import type { Request, Response } from "express";
import type { Logger } from "pino";

import type { AppDatabase } from "../db.js";
import { ActivityCache, cacheTag } from "../lib/cache.js";

interface JiraIssuePayload {
  webhookEvent: string;
  issue?: {
    key: string;
    fields?: {
      assignee?: {
        accountId?: string;
        displayName?: string;
      };
      status?: { name?: string };
      summary?: string;
    };
  };
  user?: { accountId?: string };
  changelog?: { items?: Array<{ field: string; fromString?: string; toString?: string }> };
}

interface JiraSprintPayload {
  webhookEvent: string;
  sprint?: { id: number; name: string };
}

export function createJiraWebhookHandler(
  database: AppDatabase,
  cache: ActivityCache,
  logger: Logger
) {
  return async function handleJiraWebhook(
    req: Request,
    res: Response
  ): Promise<void> {
    const orgId = String(req.query["org_id"] ?? "");
    if (!orgId) {
      res.status(400).json({ error: "Missing org_id query parameter" });
      return;
    }

    // Token-in-URL authentication (Jira's native webhook security model)
    const incomingToken = String(req.query["token"] ?? "");
    const storedSecret = getJiraWebhookSecret(database, orgId);

    if (storedSecret) {
      if (!incomingToken || !timingSafeCompare(incomingToken, storedSecret)) {
        logger.warn({ orgId }, "Jira webhook token mismatch — rejecting");
        res.status(401).json({ error: "Invalid token" });
        return;
      }
    } else {
      // No secret configured — accept but warn
      logger.warn({ orgId }, "Jira webhook received but no webhook secret configured for org — accepting unverified");
    }

    const body = req.body as JiraIssuePayload & JiraSprintPayload;
    const webhookEvent = body.webhookEvent ?? "unknown";

    logger.info({ orgId, webhookEvent }, "Jira webhook received");

    let invalidated = 0;

    try {
      if (
        webhookEvent === "jira:issue_created" ||
        webhookEvent === "jira:issue_updated" ||
        webhookEvent === "jira:issue_deleted"
      ) {
        const assigneeAccountId = body.issue?.fields?.assignee?.accountId;

        if (assigneeAccountId) {
          invalidated += cache.invalidateByTag(cacheTag.jiraIssues(assigneeAccountId));
          logger.debug(
            { assigneeAccountId, webhookEvent, invalidated },
            "Invalidated jira issues cache"
          );
        } else {
          // No assignee — we can't target a specific account; invalidate all jira issue
          // caches for the org by prefix (conservative but correct)
          invalidated += cache.invalidateByPrefix(`jira:issues:`);
          logger.debug({ webhookEvent, invalidated }, "Invalidated all jira issue caches (no assignee)");
        }
      } else if (
        webhookEvent === "jira:sprint_started" ||
        webhookEvent === "jira:sprint_closed" ||
        webhookEvent === "jira:sprint_deleted"
      ) {
        // Sprint changes affect multiple assignees — invalidate all jira caches
        invalidated += cache.invalidateByPrefix(`jira:issues:`);
        logger.debug({ webhookEvent, invalidated }, "Invalidated all jira issue caches on sprint event");
      } else {
        logger.debug({ webhookEvent }, "Jira webhook: unsupported event type, ignoring");
      }

      // Audit log (fire-and-forget)
      try {
        database.recordAuditEvent({
          organizationId: orgId,
          actorUserId: null,
          eventType: `webhook.jira.${webhookEvent}`,
          targetType: "webhook",
          targetId: body.issue?.key ?? null,
          metadata: { cacheEntriesInvalidated: invalidated }
        });
      } catch {
        // Non-fatal
      }

      res.status(200).json({ ok: true, invalidated });
    } catch (err) {
      logger.error({ orgId, webhookEvent, err }, "Error processing Jira webhook");
      res.status(500).json({ error: "Internal processing error" });
    }
  };
}

function timingSafeCompare(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, "utf8");
    const bBuf = Buffer.from(b, "utf8");
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

function getJiraWebhookSecret(database: AppDatabase, orgId: string): string | null {
  try {
    const conn = database.getJiraConnection(orgId);
    if (!conn?.metadata) return null;
    const meta = conn.metadata as Record<string, unknown>;
    return typeof meta["webhookSecret"] === "string" ? meta["webhookSecret"] : null;
  } catch {
    return null;
  }
}
