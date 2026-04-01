import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";

interface JobHandlerContext {
  config: AppConfig;
  database: AppDatabase;
  logger: Logger;
}

type ConnectorProvider = "jira" | "github";

type JobHandler = (
  ctx: JobHandlerContext,
  payload: Record<string, unknown>
) => Promise<void>;

const handlers: Record<string, JobHandler> = {
  connector_validation: async (ctx, payload) => {
    const provider = payload.provider as ConnectorProvider;
    const secretRef = payload.secretRef as string | undefined;

    if (!secretRef) {
      ctx.logger.warn({ provider }, "connector_validation: no secretRef, skipping");
      return;
    }

    if (provider === "jira") {
      await validateJiraConnection(ctx, secretRef);
    } else if (provider === "github") {
      await validateGitHubConnection(ctx, secretRef);
    } else {
      throw new Error(`Unknown provider: ${provider}`);
    }
  },

  invite_delivery: async (ctx) => {
    // Email is now sent inline in the invitation POST handler.
    // Mark these legacy jobs as completed without action.
    ctx.logger.info("invite_delivery: no-op (email sent inline)");
  }
};

async function validateJiraConnection(
  ctx: JobHandlerContext,
  secretRef: string
): Promise<void> {
  // Use the Jira myself endpoint to verify the token is valid
  const baseUrl = ctx.config.jiraBaseUrl?.replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("JIRA_BASE_URL not configured");
  }

  const authHeader = `Basic ${Buffer.from(
    `${ctx.config.jiraEmail ?? ""}:${secretRef}`
  ).toString("base64")}`;

  const response = await fetch(`${baseUrl}/rest/api/3/myself`, {
    headers: {
      Authorization: authHeader,
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(10_000)
  });

  if (!response.ok) {
    throw new Error(`Jira API returned ${response.status}: ${response.statusText}`);
  }

  ctx.logger.info("Jira connection validated successfully");
}

async function validateGitHubConnection(
  ctx: JobHandlerContext,
  secretRef: string
): Promise<void> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${secretRef}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    signal: AbortSignal.timeout(10_000)
  });

  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`);
  }

  ctx.logger.info("GitHub connection validated successfully");
}

async function processJob(
  ctx: JobHandlerContext,
  job: { id: string; organizationId: string; jobType: string; payload: Record<string, unknown> }
): Promise<void> {
  const handler = handlers[job.jobType];

  if (!handler) {
    ctx.logger.warn({ jobType: job.jobType }, "No handler for job type — marking failed");
    ctx.database.updateBackgroundJob(job.id, {
      status: "failed",
      errorMessage: `Unknown job type: ${job.jobType}`
    });
    return;
  }

  try {
    await handler(ctx, job.payload);

    ctx.database.updateBackgroundJob(job.id, { status: "completed" });

    // Update connector status on success
    if (job.jobType === "connector_validation") {
      const provider = job.payload.provider as string;
      const updater =
        provider === "jira"
          ? ctx.database.updateJiraConnection.bind(ctx.database)
          : ctx.database.updateGitHubConnection.bind(ctx.database);

      updater(job.organizationId, {
        status: "connected",
        lastValidatedAt: new Date().toISOString(),
        lastError: null
      });
    }

    ctx.logger.info({ jobId: job.id, jobType: job.jobType }, "Job completed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    ctx.database.updateBackgroundJob(job.id, {
      status: "failed",
      errorMessage: message
    });

    // Update connector status on failure
    if (job.jobType === "connector_validation") {
      const provider = job.payload.provider as string;
      const updater =
        provider === "jira"
          ? ctx.database.updateJiraConnection.bind(ctx.database)
          : ctx.database.updateGitHubConnection.bind(ctx.database);

      updater(job.organizationId, {
        status: "needs_attention",
        lastValidatedAt: new Date().toISOString(),
        lastError: message
      });
    }

    ctx.logger.error({ jobId: job.id, jobType: job.jobType, err: message }, "Job failed");
  }
}

export async function validateConnectorConnection(
  config: AppConfig,
  database: AppDatabase,
  logger: Logger,
  organizationId: string,
  provider: ConnectorProvider,
  secretRef?: string
): Promise<void> {
  const ctx: JobHandlerContext = {
    config,
    database,
    logger: logger.child({ component: "connector-validation", provider, organizationId })
  };

  if (!secretRef) {
    ctx.logger.warn("connector_validation: no secretRef, skipping");
    return;
  }

  try {
    if (provider === "jira") {
      await validateJiraConnection(ctx, secretRef);
      database.updateJiraConnection(organizationId, {
        status: "connected",
        lastValidatedAt: new Date().toISOString(),
        lastError: null
      });
    } else if (provider === "github") {
      await validateGitHubConnection(ctx, secretRef);
      database.updateGitHubConnection(organizationId, {
        status: "connected",
        lastValidatedAt: new Date().toISOString(),
        lastError: null
      });
    } else {
      throw new Error(`Unknown provider: ${provider}`);
    }

    ctx.logger.info("Connector validation completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (provider === "jira") {
      database.updateJiraConnection(organizationId, {
        status: "needs_attention",
        lastValidatedAt: new Date().toISOString(),
        lastError: message
      });
    } else {
      database.updateGitHubConnection(organizationId, {
        status: "needs_attention",
        lastValidatedAt: new Date().toISOString(),
        lastError: message
      });
    }

    ctx.logger.error({ err: message }, "Connector validation failed");
    throw error;
  }
}

export interface JobWorker {
  stop(): void;
}

export function startJobWorker(
  config: AppConfig,
  database: AppDatabase,
  logger: Logger,
  pollIntervalMs = 5_000
): JobWorker {
  const ctx: JobHandlerContext = {
    config,
    database,
    logger: logger.child({ component: "job-worker" })
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function poll() {
    if (stopped) return;

    try {
      const job = database.claimPendingJob();
      if (job) {
        ctx.logger.info({ jobId: job.id, jobType: job.jobType }, "Processing job");
        await processJob(ctx, job);
        // If we found a job, immediately check for more
        if (!stopped) {
          timer = setTimeout(poll, 0);
          return;
        }
      }
    } catch (err) {
      ctx.logger.error({ err }, "Job worker poll error");
    }

    if (!stopped) {
      timer = setTimeout(poll, pollIntervalMs);
    }
  }

  ctx.logger.info({ pollIntervalMs }, "Job worker started");
  timer = setTimeout(poll, 1_000); // initial delay before first poll

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      ctx.logger.info("Job worker stopped");
    }
  };
}
