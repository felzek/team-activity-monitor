/**
 * GitHub webhook handler.
 *
 * Validates the HMAC-SHA256 signature in X-Hub-Signature-256, parses the event,
 * and immediately invalidates the relevant cache tags so the next query fetches
 * fresh data.
 *
 * Supported events: push, pull_request, create, delete, issues
 * Unsupported events: silently ignored with 200 OK.
 *
 * Security:
 *  - Raw body is read before JSON parsing to preserve the exact bytes for HMAC.
 *  - timingSafeEqual is used for constant-time comparison.
 *  - The webhook secret is loaded per-org from github_connections.metadata_json.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type { Request, Response } from "express";
import type { Logger } from "pino";

import type { AppDatabase } from "../db.js";
import { cacheTag } from "../lib/cache.js";
import type { ActivityCache } from "../lib/cache.js";

interface GitHubPushPayload {
  repository: { full_name: string; owner: { login: string }; name: string };
  pusher?: { name: string };
  commits?: Array<{ id: string; message: string }>;
}

interface GitHubPrPayload {
  action: string;
  pull_request: {
    number: number;
    title: string;
    user: { login: string };
    head: { repo: { full_name: string } };
  };
  repository: { full_name: string; owner: { login: string }; name: string };
}

interface GitHubIssuesPayload {
  action: string;
  issue: { number: number; title: string };
  repository: { full_name: string };
}

export function createGitHubWebhookHandler(
  database: AppDatabase,
  cache: ActivityCache,
  logger: Logger
) {
  return async function handleGitHubWebhook(
    req: Request,
    res: Response
  ): Promise<void> {
    const orgId = String(req.query["org_id"] ?? "");
    if (!orgId) {
      res.status(400).json({ error: "Missing org_id query parameter" });
      return;
    }

    // Raw body must have been captured by express.raw() middleware on this route
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      res.status(400).json({ error: "Raw body not available — check middleware configuration" });
      return;
    }

    // Load webhook secret for this org
    const secret = getWebhookSecret(database, orgId, "github");
    if (!secret) {
      // No secret configured → accept (useful during initial setup, log warning)
      logger.warn({ orgId }, "GitHub webhook received but no webhook secret configured for org — accepting unverified");
    } else {
      const signature = req.headers["x-hub-signature-256"] as string | undefined;
      if (!verifyGitHubSignature(secret, rawBody, signature)) {
        logger.warn({ orgId }, "GitHub webhook signature mismatch — rejecting");
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    }

    const eventType = req.headers["x-github-event"] as string | undefined;
    const deliveryId = req.headers["x-github-delivery"] as string | undefined;

    logger.info({ orgId, eventType, deliveryId }, "GitHub webhook received");

    let invalidated = 0;

    try {
      const payload = req.body as Record<string, unknown>;

      switch (eventType) {
        case "push": {
          const push = payload as unknown as GitHubPushPayload;
          const fullName = push.repository?.full_name;
          if (fullName) {
            invalidated += cache.invalidateByTag(cacheTag.githubCommits(fullName));
            logger.debug({ fullName, invalidated }, "Invalidated github commits cache on push");
          }
          break;
        }

        case "pull_request": {
          const pr = payload as unknown as GitHubPrPayload;
          const fullName = pr.repository?.full_name;
          if (fullName) {
            invalidated += cache.invalidateByTag(cacheTag.githubPrs(fullName));
            logger.debug({ fullName, action: pr.action, invalidated }, "Invalidated github PRs cache on pull_request");
          }
          break;
        }

        case "issues": {
          // Issues events may affect team member activity views
          const issues = payload as unknown as GitHubIssuesPayload;
          const fullName = issues.repository?.full_name;
          if (fullName) {
            // GitHub issues are separate from Jira; invalidate the repo PR/commit cache
            // in case the activity view includes linked issues
            invalidated += cache.invalidateByTag(cacheTag.githubPrs(fullName));
          }
          break;
        }

        case "create":
        case "delete": {
          // Branch/tag create or delete — invalidate commits cache for the repo
          const repoPayload = payload as { repository?: { full_name?: string } };
          const fullName = repoPayload.repository?.full_name;
          if (fullName) {
            invalidated += cache.invalidateByTag(cacheTag.githubCommits(fullName));
          }
          break;
        }

        default:
          // Unsupported event — accept silently
          logger.debug({ eventType }, "GitHub webhook: unsupported event type, ignoring");
          break;
      }

      // Log to audit trail (fire-and-forget)
      try {
        database.recordAuditEvent({
          organizationId: orgId,
          actorUserId: null,
          eventType: `webhook.github.${eventType ?? "unknown"}`,
          targetType: "webhook",
          targetId: deliveryId ?? null,
          metadata: { cacheEntriesInvalidated: invalidated }
        });
      } catch {
        // Audit logging failure is non-fatal
      }

      res.status(200).json({ ok: true, invalidated });
    } catch (err) {
      logger.error({ orgId, eventType, err }, "Error processing GitHub webhook");
      res.status(500).json({ error: "Internal processing error" });
    }
  };
}

function verifyGitHubSignature(
  secret: string,
  rawBody: Buffer,
  signatureHeader: string | undefined
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const actual = signatureHeader;

  try {
    const expectedBuf = Buffer.from(expected, "utf8");
    const actualBuf = Buffer.from(actual, "utf8");
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

function getWebhookSecret(
  database: AppDatabase,
  orgId: string,
  provider: "github" | "jira"
): string | null {
  try {
    const conn = provider === "github"
      ? database.getGitHubConnection(orgId)
      : database.getJiraConnection(orgId);

    if (!conn?.metadata) return null;
    const meta = conn.metadata as Record<string, unknown>;
    return typeof meta["webhookSecret"] === "string" ? meta["webhookSecret"] : null;
  } catch {
    return null;
  }
}
