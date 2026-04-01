import { randomUUID } from "node:crypto";
import path from "node:path";

import express from "express";
import session from "express-session";
import type { Logger } from "pino";
import { z } from "zod";

import {
  ensureCsrfToken,
  hashPassword,
  redirectAuthenticatedPage,
  requireAuth,
  requireAuthPage,
  requireCsrf,
  requireOrganization,
  requireProviderConnections,
  toSessionUser,
  validateConnectorInput,
  validateInviteInput,
  validateProviderParam,
  validateRegistrationInput,
  verifyPassword
} from "./auth.js";
import type { AppConfig } from "./config.js";
import { teamMemberSchema, trackedRepoSchema } from "./config.js";
import type { AppDatabase } from "./db.js";
import { ActivityCache, getSharedCache } from "./lib/cache.js";
import { fetchGitHubDashboard } from "./dashboard/github.js";
import { fetchJiraDashboard } from "./dashboard/jira.js";
import { generateDashboardInsight } from "./lib/ollama.js";
import { runChatTurn } from "./lib/chat-pipeline.js";
import type { NormalizedChatMessage } from "./llm/types.js";
import { sendInvitationEmail } from "./lib/email.js";
import { AppError, isAppError, toErrorMessage } from "./lib/errors.js";
import { createHttpLogger } from "./lib/logger.js";
import { buildGroundedResponsePrompt, generateGroundedResponse, RESPONSE_SYSTEM_PROMPT } from "./lib/llm-pipeline.js";
import { syncGitHubProfileToOrg, syncJiraProfileToOrg } from "./lib/profile-sync.js";
import { createGitHubWebhookHandler } from "./webhooks/github.js";
import { createJiraWebhookHandler } from "./webhooks/jira.js";
import {
  applyProviderAuthRuntime,
  buildProviderAuthorizationUrl,
  buildProviderAuthFlowState,
  completeProviderAuthorization,
  getProviderConnectionMode,
  refreshJiraToken
} from "./lib/provider-auth.js";
import { createRateLimitMiddleware } from "./lib/rate-limit.js";
import { AnthropicAdapter } from "./llm/adapters/anthropic.js";
import { GatewayAdapter } from "./llm/adapters/gateway.js";
import { GeminiAdapter } from "./llm/adapters/gemini.js";
import { OllamaAdapter } from "./llm/adapters/ollama.js";
import { OpenAiAdapter } from "./llm/adapters/openai.js";
import { LlmProviderRegistry } from "./llm/registry.js";
import { LlmService } from "./llm/service.js";
import { buildActivitySummary } from "./orchestrator/activity.js";
import { resolveIdentity } from "./query/identity.js";
import { parseQuery } from "./query/parser.js";
import { createArtifactsRouter } from "./routes/artifacts.js";
import { createConversationsRouter } from "./routes/conversations.js";
import { createIntelligenceRouter } from "./routes/intelligence.js";
import { createLlmRouter } from "./routes/llm.js";
import { validateConnectorConnection } from "./lib/job-worker.js";
import type { LlmProvider, OrganizationSettings, OrganizationSummary, ProviderAuthProvider, SessionSnapshot } from "./types/auth.js";
import type { ParsedQuery, ProviderIntegrationContext } from "./types/activity.js";

const PUBLIC_DIR = path.resolve(process.cwd(), "public");

function sendPublicFile(response: express.Response, fileName: string): void {
  response.sendFile(fileName, { root: PUBLIC_DIR });
}

function fallbackDisplayName(email: string, providedName?: string | null): string {
  if (providedName && providedName.trim().length >= 2) {
    return providedName.trim();
  }

  const localPart = email.split("@")[0] ?? "team-activity-user";
  const normalized = localPart
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized) {
    return "Team Activity User";
  }

  return normalized
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function applySecurityHeaders(app: express.Express, appEnv: string): void {
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    response.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        `script-src 'self'${appEnv === "development" ? " 'unsafe-eval'" : ""}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "font-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'"
      ].join("; ")
    );
    next();
  });
}

function normalizeOrganizationSettingsPayload(body: unknown): OrganizationSettings {
  const teamMembersValue =
    typeof (body as Record<string, unknown>)?.teamMembers === "string"
      ? JSON.parse(String((body as Record<string, unknown>).teamMembers))
      : (body as Record<string, unknown>)?.teamMembers;
  const trackedReposValue =
    typeof (body as Record<string, unknown>)?.trackedRepos === "string"
      ? JSON.parse(String((body as Record<string, unknown>).trackedRepos))
      : (body as Record<string, unknown>)?.trackedRepos;

  return {
    teamMembers: z.array(teamMemberSchema).parse(teamMembersValue),
    trackedRepos: z.array(trackedRepoSchema).parse(trackedReposValue).filter((repo) => !repo.disabled)
  };
}

function filteredParsedQuery(
  parsedQuery: ParsedQuery,
  connectorState: {
    jiraEnabled: boolean;
    githubEnabled: boolean;
  }
): ParsedQuery {
  return {
    ...parsedQuery,
    requestedSources: parsedQuery.requestedSources.filter((provider) => {
      if (provider === "jira") {
        return connectorState.jiraEnabled;
      }

      if (provider === "github") {
        return connectorState.githubEnabled;
      }

      return true;
    })
  };
}

function buildWorkspaceProviderIntegration(
  label: "Jira" | "GitHub",
  workspaceEnabled: boolean,
  originallyRequested: boolean,
  queryIncluded: boolean,
  credentialPresent: boolean
): ProviderIntegrationContext {
  let explanation: string;
  if (!originallyRequested) {
    explanation = `${label} was not in scope for this query intent.`;
  } else if (!workspaceEnabled) {
    explanation = `${label} is not connected for this workspace — the connector is disabled, so no ${label} data was fetched.`;
  } else if (!queryIncluded) {
    explanation = `${label} was expected but was not included for this query (workspace connector settings).`;
  } else if (!credentialPresent) {
    explanation = `${label} was in scope but no user OAuth token was available for this request; results may be incomplete or rely on server fallback credentials.`;
  } else {
    explanation = `${label} is connected for this workspace with a user credential; the JSON status and items reflect the API outcome.`;
  }

  return {
    workspaceConnectorEnabled: workspaceEnabled,
    queryIncludedProvider: queryIncluded,
    userCredentialPresent: credentialPresent,
    explanation
  };
}

function baseProviderAuthRequirement(): SessionSnapshot["providerAuth"] {
  return {
    mode: "unavailable",
    providerModes: {
      github: "unavailable",
      jira: "unavailable",
      google: "unavailable"
    },
    requiredProviders: ["github", "jira"],
    missingProviders: ["github", "jira"],
    allConnected: false,
    jira: null,
    github: null,
    google: null
  };
}

function buildSessionSnapshot(
  request: express.Request,
  database: AppDatabase,
  config: AppConfig
): SessionSnapshot {
  const userId = request.session.userId;
  const csrfToken = request.session.csrfToken ?? null;

  if (!userId) {
    return {
      authenticated: false,
      user: null,
      currentOrganization: null,
      organizations: [],
      csrfToken,
      authMode: "local",
      providerAuth: applyProviderAuthRuntime(config, baseProviderAuthRequirement()),
      llmProviderKeys: []
    };
  }

  const user = database.findUserById(userId);
  if (!user) {
    request.session.userId = undefined;
    request.session.currentOrganizationId = undefined;
    return {
      authenticated: false,
      user: null,
      currentOrganization: null,
      organizations: [],
      csrfToken,
      authMode: "local",
      providerAuth: applyProviderAuthRuntime(config, baseProviderAuthRequirement()),
      llmProviderKeys: []
    };
  }

  const organizations = database.listUserOrganizations(userId);
  let currentOrganization =
    organizations.find((organization) => organization.id === request.session.currentOrganizationId) ??
    organizations[0] ??
    null;

  if (currentOrganization) {
    request.session.currentOrganizationId = currentOrganization.id;
  }

  return {
    authenticated: true,
    user: toSessionUser(user),
    currentOrganization,
    organizations,
    csrfToken,
    authMode: "local",
    providerAuth: applyProviderAuthRuntime(
      config,
      database.getProviderAuthRequirement(userId)
    ),
    llmProviderKeys: database.listLlmProviderKeys(userId)
  };
}

function routeOrganizationId(request: express.Request): string | undefined {
  return Array.isArray(request.params.orgId) ? request.params.orgId[0] : request.params.orgId;
}

function requireActiveOrganization(
  request: express.Request,
  organizations: OrganizationSummary[]
): OrganizationSummary {
  const organization =
    organizations.find((entry) => entry.id === request.session.currentOrganizationId) ??
    organizations[0];

  if (!organization) {
    throw new AppError("No organization is available for this account.", {
      code: "NO_ORGANIZATION",
      statusCode: 403
    });
  }

  request.session.currentOrganizationId = organization.id;
  return organization;
}

function providerResultPath(
  entry: "login" | "connect",
  provider: ProviderAuthProvider,
  status: "connected" | "error",
  message?: string
): string {
  const basePath = status === "connected" ? "/app" : entry === "connect" ? "/app" : "/login";
  const search = new URLSearchParams({
    provider_auth: status,
    provider
  });

  if (message) {
    search.set("message", message);
  }

  return `${basePath}?${search.toString()}`;
}

// 5-minute buffer: refresh before actual expiry to avoid mid-request failures
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

async function getActiveProviderToken(
  userId: string,
  provider: "github" | "jira",
  config: AppConfig,
  database: AppDatabase,
  logger: Logger
): Promise<string | undefined> {
  const tokenData = database.getUserProviderToken(userId, provider);
  if (!tokenData) return undefined;

  if (tokenData.expiresAt) {
    const expiresAt = new Date(tokenData.expiresAt).getTime();

    if (expiresAt < Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      if (!tokenData.refreshToken) {
        logger.warn({ userId, provider }, "Provider token expired — no refresh token stored. User must reconnect.");
        return undefined;
      }

      if (provider === "jira") {
        try {
          const refreshed = await refreshJiraToken(config, tokenData.refreshToken);
          database.updateProviderTokens(userId, "jira", refreshed);
          logger.info({ userId }, "Jira OAuth token refreshed transparently");
          return refreshed.accessToken;
        } catch (err) {
          logger.warn(
            { userId, error: toErrorMessage(err) },
            "Jira token refresh failed — proceeding without user token"
          );
          return undefined;
        }
      }
    }
  }

  return tokenData.accessToken;
}

export function createApp(config: AppConfig, logger: Logger, database: AppDatabase) {
  const app = express();

  // Build the LLM service once so it's accessible to all routes (query + /api/llm/*)
  // OllamaAdapter is always registered — it returns empty list gracefully when not running.
  const llmRegistry = new LlmProviderRegistry()
    .register(new GatewayAdapter(config))
    .register(new AnthropicAdapter())
    .register(new OpenAiAdapter())
    .register(new GeminiAdapter())
    .register(new OllamaAdapter(config.ollamaBaseUrl, config.ollamaModel, config.ollamaKeepAlive, logger));
  const llmService = new LlmService(llmRegistry, database, logger);

  applySecurityHeaders(app, config.appEnv);
  app.use(createHttpLogger());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      name: "tam_sid",
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: database.sessionStore,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.secureCookies,
        maxAge: 1000 * 60 * 60 * 24 * 7
      }
    })
  );
  app.use(ensureCsrfToken);
  app.use(
    createRateLimitMiddleware({
      windowMs: config.rateLimitWindowMs,
      maxRequests: config.rateLimitMaxRequests
    })
  );
  app.use(express.static(path.resolve(process.cwd(), "public"), { index: false }));
  app.use("/api", requireCsrf);

  // ── Sub-routers ────────────────────────────────────────────────────────────
  app.use("/api/llm", createLlmRouter(llmService, logger));
  app.use("/api/v1/artifacts", createArtifactsRouter(config, database, logger));
  app.use(createIntelligenceRouter(config, database, logger));
  app.use(createConversationsRouter(database, logger));

  app.get("/", (_request, response) => {
    sendPublicFile(response, "index.html");
  });

  app.get("/login", redirectAuthenticatedPage, (_request, response) => {
    sendPublicFile(response, "login.html");
  });

  app.get("/register", redirectAuthenticatedPage, (_request, response) => {
    sendPublicFile(response, "register.html");
  });

  // ── React SPA routes — serve the compiled Vite bundle ──────────────────────
  const SPA_INDEX = path.resolve(process.cwd(), "public/app/index.html");
  app.get(["/app", "/app/*splat", "/intelligence", "/chat", "/settings", "/settings/*splat"], requireAuthPage, (_request, response) => {
    response.sendFile(SPA_INDEX);
  });

  app.get("/docs", (_request, response) => {
    sendPublicFile(response, "docs.html");
  });

  app.get("/security", (_request, response) => {
    sendPublicFile(response, "security.html");
  });

  app.get("/status", (_request, response) => {
    sendPublicFile(response, "status.html");
  });

  app.get(["/api/health", "/health/live"], (_request, response) => {
    response.json({
      ok: true,
      status: "live",
      env: config.appEnv,
      mode: config.useRecordedFixtures ? "fixture" : "live",
      appName: config.appName
    });
  });

  app.get("/health/ready", (_request, response) => {
    try {
      database.ping();
      response.json({
        ok: true,
        status: "ready",
        env: config.appEnv,
        mode: config.useRecordedFixtures ? "fixture" : "live",
        trackedRepoCount: config.trackedRepos.length,
        teamMemberCount: config.teamMembers.length
      });
    } catch (error) {
      response.status(503).json({
        ok: false,
        status: "not_ready",
        error: error instanceof Error ? error.message : "Database is unavailable."
      });
    }
  });

  app.get("/health/startup", (_request, response) => {
    response.json({
      ok: true,
      status: "started",
      env: config.appEnv,
      awsRegion: config.awsRegion,
      authMode: "local",
      cognitoConfigured: Boolean(
        config.cognitoAppClientId && config.cognitoDomain && config.cognitoUserPoolId
      )
    });
  });

  // Demo endpoints — no auth required, use fixture data
  app.get("/api/v1/demo/session", (request, response) => {
    const csrfToken = request.session.csrfToken ?? null;
    const demoOrgId = request.session.demoOrganizationId;

    if (demoOrgId) {
      response.json({ csrfToken, organizationId: demoOrgId });
      return;
    }

    const demoEmail = `demo-${randomUUID().slice(0, 8)}@demo.local`;
    const { user: demoUser, organization: demoOrg } = database.createUserWithOrganization({
      name: "Demo User",
      email: demoEmail,
      passwordHash: "demo-no-login",
      organizationName: "Demo Workspace"
    });

    database.updateOrganizationSettings(demoOrg.id, {
      teamMembers: config.teamMembers,
      trackedRepos: config.trackedRepos
    });

    request.session.demoOrganizationId = demoOrg.id;
    request.session.demoUserId = demoUser.id;

    response.json({ csrfToken, organizationId: demoOrg.id });
  });

  app.post("/api/v1/demo/query", async (request, response) => {
    const demoOrgId = request.session.demoOrganizationId;
    const demoUserId = request.session.demoUserId;

    if (!demoOrgId || !demoUserId) {
      throw new AppError("Demo session not initialized. Call GET /api/v1/demo/session first.", {
        code: "DEMO_NOT_INITIALIZED",
        statusCode: 400
      });
    }

    const query = typeof request.body?.query === "string" ? request.body.query.trim() : "";

    if (!query) {
      throw new AppError("A non-empty query is required.", {
        code: "EMPTY_QUERY",
        statusCode: 400
      });
    }

    const demoConfig = {
      ...config,
      useRecordedFixtures: true
    };

    const orgSettings = database.getOrganizationSettings(demoOrgId);
    const executionConfig = {
      ...demoConfig,
      teamMembers: orgSettings.teamMembers,
      trackedRepos: orgSettings.trackedRepos
    };

    const parsedQuery = parseQuery(query, config.appTimezone);
    const identity = resolveIdentity(
      parsedQuery.memberText,
      parsedQuery.rawQuery,
      executionConfig.teamMembers
    );

    const demoLogger = logger.child({ demo: true, query });

    const summary = await buildActivitySummary(
      executionConfig,
      parsedQuery,
      identity,
      demoLogger
    );

    const responseText = await generateGroundedResponse(executionConfig, summary, demoLogger);

    response.json({
      query,
      parsedQuery,
      summary,
      responseText
    });
  });

  app.get(["/api/auth/session", "/api/v1/auth/session"], (request, response) => {
    response.json(buildSessionSnapshot(request, database, config));
  });

  app.get("/api/v1/auth/providers", requireAuth, (request, response) => {
    response.json({
      providerAuth: applyProviderAuthRuntime(
        config,
        database.getProviderAuthRequirement(request.session.userId!),
      )
    });
  });

  app.get("/api/v1/auth/providers/:provider/start", (request, response) => {
    const provider = validateProviderParam(
      Array.isArray(request.params.provider)
        ? request.params.provider[0]
        : request.params.provider ?? ""
    );

    try {
      if (getProviderConnectionMode(config, provider) === "unavailable") {
        throw new AppError(`${provider} sign-in is not available in this environment.`, {
          code: "PROVIDER_AUTH_MODE_UNAVAILABLE",
          statusCode: 501
        });
      }

      const entry = request.session.userId ? "connect" : "login";
      const flow = buildProviderAuthFlowState(
        provider,
        entry,
        request.session.userId ?? null
      );

      request.session.providerAuthFlows ??= {};
      request.session.providerAuthFlows[provider] = flow;
      response.redirect(buildProviderAuthorizationUrl(config, flow));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Provider sign-in could not be started.";
      response.redirect(providerResultPath(request.session.userId ? "connect" : "login", provider, "error", message));
    }
  });

  app.get("/api/v1/auth/providers/:provider/callback", async (request, response) => {
    const provider = validateProviderParam(
      Array.isArray(request.params.provider)
        ? request.params.provider[0]
        : request.params.provider ?? ""
    );
    const flow = request.session.providerAuthFlows?.[provider];
    const fallbackEntry = request.session.userId ? "connect" : "login";
    const entry = flow?.entry ?? fallbackEntry;

    const finishWithError = (message: string) => {
      if (request.session.providerAuthFlows) {
        delete request.session.providerAuthFlows[provider];
      }

      response.redirect(providerResultPath(entry, provider, "error", message));
    };

    if (!flow) {
      finishWithError("Provider sign-in expired before the callback completed. Start again.");
      return;
    }

    if (request.session.providerAuthFlows) {
      delete request.session.providerAuthFlows[provider];
    }

    const state = String(request.query.state ?? "");
    const code = String(request.query.code ?? "");
    const providerError = String(request.query.error ?? "");
    const providerErrorDescription = String(request.query.error_description ?? "");

    if (providerError) {
      finishWithError(providerErrorDescription || providerError);
      return;
    }

    if (!state || state !== flow.state) {
      finishWithError("Provider sign-in could not be verified. Please try again.");
      return;
    }

    if (!code) {
      finishWithError("Provider sign-in did not return an authorization code.");
      return;
    }

    try {
      const identity = await completeProviderAuthorization(config, provider, code, flow);
      const existingLink = database.findUserProviderConnectionByExternalAccount(
        provider,
        identity.externalAccountId
      );
      let user = flow.startedByUserId ? database.findUserById(flow.startedByUserId) : null;
      let organization: OrganizationSummary | null = null;
      let createdAccount = false;

      if (flow.entry === "connect") {
        if (!flow.startedByUserId || !user) {
          throw new AppError("You must be signed in before linking a provider account.", {
            code: "AUTH_SESSION_MISSING",
            statusCode: 401
          });
        }

        if (existingLink && existingLink.userId !== user.id) {
          throw new AppError(
            "That provider account is already linked to another workspace user.",
            {
              code: "PROVIDER_ACCOUNT_ALREADY_LINKED",
              statusCode: 409
            }
          );
        }

        request.session.userId = user.id;
        organization = requireActiveOrganization(
          request,
          database.listUserOrganizations(user.id)
        );
      } else {
        if (existingLink) {
          user = database.findUserById(existingLink.userId);
        }

        if (!user && identity.email) {
          user = database.findUserByEmail(identity.email);
        }

        if (!user) {
          if (!identity.email) {
            throw new AppError(
              "The provider did not return an email address, so a workspace account could not be created.",
              {
                code: "PROVIDER_EMAIL_REQUIRED",
                statusCode: 400
              }
            );
          }

          const displayName = fallbackDisplayName(identity.email, identity.displayName);
          const created = database.createUserWithOrganization({
            name: displayName,
            email: identity.email,
            passwordHash: await hashPassword(randomUUID()),
            organizationName: `${displayName}'s workspace`
          });

          user = created.user;
          organization = created.organization;
          createdAccount = true;
          request.session.userId = created.user.id;
          request.session.currentOrganizationId = created.organization.id;

          database.recordAuditEvent({
            organizationId: created.organization.id,
            actorUserId: created.user.id,
            eventType: "auth.registered",
            targetType: "user",
            targetId: created.user.id,
            metadata: {
              email: created.user.email,
              provider,
              authMethod: "oauth"
            }
          });
        } else {
          request.session.userId = user.id;
          organization = requireActiveOrganization(
            request,
            database.listUserOrganizations(user.id)
          );
        }

        if (!organization && user) {
          organization = requireActiveOrganization(
            request,
            database.listUserOrganizations(user.id)
          );
        }

        if (!user || !organization) {
          throw new AppError("Provider sign-in could not be attached to a workspace user.", {
            code: "PROVIDER_LOGIN_FAILED",
            statusCode: 400
          });
        }

        database.recordAuditEvent({
          organizationId: organization.id,
          actorUserId: user.id,
          eventType: "auth.signed_in",
          targetType: "user",
          targetId: user.id,
          metadata: {
            email: user.email,
            provider,
            authMethod: "oauth",
            createdAccount
          }
        });
      }

      const connector = database.upsertUserProviderConnection(user.id, provider, {
        status: "connected",
        externalAccountId: identity.externalAccountId,
        displayName: identity.displayName ?? user.name,
        login: identity.login,
        email: identity.email ?? user.email,
        authMethod: "oauth",
        connectedAt: new Date().toISOString(),
        metadata: identity.metadata,
        accessToken: identity.accessToken,
        refreshToken: identity.refreshToken,
        tokenExpiresAt: identity.tokenExpiresAt
      });

      database.recordAuditEvent({
        organizationId: organization.id,
        actorUserId: user.id,
        eventType: "provider_auth.connected",
        targetType: `${provider}_auth`,
        targetId: connector.id,
        metadata: {
          provider,
          authMethod: "oauth",
          connectedFrom: flow.entry
        }
      });

      // Auto-populate org team members and repos from the connected provider profile
      if (provider === "github" && identity.login) {
        await syncGitHubProfileToOrg(
          user.id,
          organization.id,
          identity.accessToken,
          identity.login,
          identity.displayName,
          database,
          logger
        );
      } else if (provider === "jira" && identity.externalAccountId) {
        syncJiraProfileToOrg(
          user.id,
          organization.id,
          identity.externalAccountId,
          identity.displayName,
          database,
          logger
        );
      }

      response.redirect(
        providerResultPath(
          flow.entry,
          provider,
          "connected",
          createdAccount ? "Account created and provider connected." : undefined
        )
      );
    } catch (error) {
      finishWithError(
        error instanceof Error ? error.message : "Provider sign-in could not be completed."
      );
    }
  });

  app.delete("/api/v1/auth/providers/:provider", requireAuth, (request, response) => {
    const provider = validateProviderParam(
      Array.isArray(request.params.provider)
        ? request.params.provider[0]
        : request.params.provider ?? ""
    );
    const userId = request.session.userId!;
    const connector = database.disconnectUserProviderConnection(userId, provider);
    const organizations = database.listUserOrganizations(userId);
    const organization = requireActiveOrganization(request, organizations);

    database.recordAuditEvent({
      organizationId: organization.id,
      actorUserId: userId,
      eventType: "provider_auth.disconnected",
      targetType: `${provider}_auth`,
      targetId: connector.id,
      metadata: {
        provider
      }
    });

    response.json({
      connector,
      providerAuth: applyProviderAuthRuntime(
        config,
        database.getProviderAuthRequirement(userId)
      )
    });
  });

  const LLM_PROVIDERS = new Set(["openai", "gemini", "claude"]);

  function validateLlmProvider(value: string): LlmProvider {
    if (!LLM_PROVIDERS.has(value)) {
      throw new AppError(`Invalid LLM provider: ${value}. Must be one of openai, gemini, claude.`, {
        code: "INVALID_LLM_PROVIDER",
        statusCode: 400
      });
    }
    return value as LlmProvider;
  }

  app.get("/api/v1/auth/llm-keys", requireAuth, (request, response) => {
    const keys = database.listLlmProviderKeys(request.session.userId!);
    response.json({ items: keys });
  });

  app.put("/api/v1/auth/llm-keys/:provider", requireAuth, (request, response) => {
    const provider = validateLlmProvider(
      Array.isArray(request.params.provider) ? request.params.provider[0] : request.params.provider ?? ""
    );
    const apiKey = String(request.body?.apiKey ?? "").trim();

    if (!apiKey) {
      throw new AppError("An API key is required.", {
        code: "MISSING_API_KEY",
        statusCode: 400
      });
    }

    if (apiKey.length < 8) {
      throw new AppError("API key is too short to be valid.", {
        code: "INVALID_API_KEY",
        statusCode: 400
      });
    }

    const key = database.upsertLlmProviderKey(request.session.userId!, provider, apiKey);

    const organizations = database.listUserOrganizations(request.session.userId!);
    const organization = organizations[0];
    if (organization) {
      database.recordAuditEvent({
        organizationId: organization.id,
        actorUserId: request.session.userId!,
        eventType: "llm_key.saved",
        targetType: "llm_provider_key",
        targetId: key.id,
        metadata: { provider }
      });
    }

    response.json({
      key,
      llmProviderKeys: database.listLlmProviderKeys(request.session.userId!)
    });
  });

  app.delete("/api/v1/auth/llm-keys/:provider", requireAuth, (request, response) => {
    const provider = validateLlmProvider(
      Array.isArray(request.params.provider) ? request.params.provider[0] : request.params.provider ?? ""
    );
    const userId = request.session.userId!;
    const deleted = database.deleteLlmProviderKey(userId, provider);

    if (!deleted) {
      throw new AppError(`No ${provider} API key found to remove.`, {
        code: "LLM_KEY_NOT_FOUND",
        statusCode: 404
      });
    }

    const organizations = database.listUserOrganizations(userId);
    const organization = organizations[0];
    if (organization) {
      database.recordAuditEvent({
        organizationId: organization.id,
        actorUserId: userId,
        eventType: "llm_key.removed",
        targetType: "llm_provider_key",
        metadata: { provider }
      });
    }

    response.json({
      removed: true,
      provider,
      llmProviderKeys: database.listLlmProviderKeys(userId)
    });
  });

  app.get("/api/v1/auth/invitations/:token", (request, response) => {
    const invitation = database.findInvitationByToken(request.params.token, config.appBaseUrl);

    if (!invitation) {
      response.status(404).json({
        error: "Invitation not found."
      });
      return;
    }

    response.json({
      invitation
    });
  });

  app.post(["/api/auth/register", "/api/v1/auth/register"], async (request, response) => {
    const input = validateRegistrationInput(request.body ?? {});
    const existingUser = database.findUserByEmail(input.email);

    if (existingUser) {
      throw new AppError("An account with that email already exists.", {
        code: "EMAIL_ALREADY_EXISTS",
        statusCode: 409
      });
    }

    const passwordHash = await hashPassword(input.password);

    let result: { user: ReturnType<typeof toSessionUser>; organization: OrganizationSummary } | null = null;

    try {
      const created =
        input.inviteToken
          ? database.createUserFromInvitation({
              name: input.name,
              email: input.email,
              passwordHash,
              inviteToken: input.inviteToken
            })
          : database.createUserWithOrganization({
              name: input.name,
              email: input.email,
              passwordHash,
              organizationName: input.organizationName ?? undefined
            });

      request.session.userId = created.user.id;
      request.session.currentOrganizationId = created.organization.id;

      database.recordAuditEvent({
        organizationId: created.organization.id,
        actorUserId: created.user.id,
        eventType: input.inviteToken ? "invitation.accepted" : "auth.registered",
        targetType: input.inviteToken ? "invitation" : "user",
        targetId: created.user.id,
        metadata: {
          email: created.user.email
        }
      });

      result = {
        user: toSessionUser(created.user),
        organization: created.organization
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        throw new AppError("An account with that email already exists.", {
          code: "EMAIL_ALREADY_EXISTS",
          statusCode: 409,
          cause: error
        });
      }

      if (error instanceof Error) {
        throw new AppError(error.message, {
          code: "REGISTRATION_FAILED",
          statusCode: 400,
          cause: error
        });
      }

      throw error;
    }

    response.status(201).json({
      ...buildSessionSnapshot(request, database, config),
      registeredUser: result?.user ?? null,
      createdOrganization: result?.organization ?? null
    });
  });

  app.post(["/api/auth/login", "/api/v1/auth/login"], async (request, response) => {
    const email = String(request.body?.email ?? "").trim().toLowerCase();
    const password = String(request.body?.password ?? "");

    if (!email || !password) {
      throw new AppError("Email and password are required.", {
        code: "MISSING_CREDENTIALS",
        statusCode: 400
      });
    }

    const user = database.findUserByEmail(email);
    const isValidPassword =
      user ? await verifyPassword(password, user.passwordHash) : false;

    if (!user || !isValidPassword) {
      throw new AppError("Incorrect email or password.", {
        code: "INVALID_CREDENTIALS",
        statusCode: 401
      });
    }

    request.session.userId = user.id;
    const organizations = database.listUserOrganizations(user.id);
    const organization = requireActiveOrganization(request, organizations);

    database.recordAuditEvent({
      organizationId: organization.id,
      actorUserId: user.id,
      eventType: "auth.signed_in",
      targetType: "user",
      targetId: user.id,
      metadata: {
        email: user.email
      }
    });

    response.json(buildSessionSnapshot(request, database, config));
  });

  app.post(["/api/auth/logout", "/api/v1/auth/logout"], (request, response) => {
    request.session.destroy((error) => {
      if (error) {
        response.status(500).json({
          error: "Could not sign out."
        });
        return;
      }

      response.clearCookie("tam_sid");
      response.json({
        authenticated: false
      });
    });
  });

  app.post("/api/v1/auth/switch-organization", requireAuth, (request, response) => {
    const organizationId = String(request.body?.organizationId ?? "").trim();
    const userId = request.session.userId!;
    const organization = database.getOrganizationForUser(userId, organizationId);

    if (!organization) {
      throw new AppError("You do not have access to that organization.", {
        code: "ORG_ACCESS_DENIED",
        statusCode: 403
      });
    }

    request.session.currentOrganizationId = organization.id;
    database.recordAuditEvent({
      organizationId: organization.id,
      actorUserId: userId,
      eventType: "auth.switched_organization",
      targetType: "organization",
      targetId: organization.id
    });

    response.json(buildSessionSnapshot(request, database, config));
  });

  app.get("/api/v1/orgs", requireAuth, (request, response) => {
    const snapshot = buildSessionSnapshot(request, database, config);
    response.json({
      organizations: snapshot.organizations,
      currentOrganization: snapshot.currentOrganization
    });
  });

  app.get(
    "/api/v1/orgs/:orgId/members",
    requireAuth,
    requireOrganization(database),
    (request, response) => {
      const organizationId = routeOrganizationId(request)!;
      const members = database.listOrganizationMembers(organizationId);
      response.json({
        members: members.map((m) => ({
          id: m.userId,
          displayName: m.name,
          email: m.email,
          role: m.role,
          joinedAt: m.joinedAt
        }))
      });
    }
  );

  app.get(
    "/api/v1/orgs/:orgId/invitations",
    requireAuth,
    requireOrganization(database, ["owner", "admin"]),
    (request, response) => {
      const organizationId = routeOrganizationId(request)!;
      response.json({
        invitations: database.listInvitations(organizationId, config.appBaseUrl)
      });
    }
  );

  app.post(
    "/api/v1/orgs/:orgId/invitations",
    requireAuth,
    requireOrganization(database, ["owner", "admin"]),
    async (request, response) => {
      const organizationId = routeOrganizationId(request)!;
      const userId = request.session.userId!;
      const input = validateInviteInput(request.body ?? {});
      const invitation = database.createInvitation({
        organizationId,
        email: input.email,
        role: input.role,
        createdByUserId: userId,
        baseUrl: config.appBaseUrl
      });

      database.recordAuditEvent({
        organizationId,
        actorUserId: userId,
        eventType: "invitation.created",
        targetType: "invitation",
        targetId: invitation.id,
        metadata: {
          email: invitation.email,
          role: invitation.role
        }
      });

      // Send the invitation email
      const inviter = database.findUserById(userId);
      const organization = database.getOrganizationForUser(userId, organizationId);
      const emailSent = await sendInvitationEmail(config, logger, {
        to: invitation.email,
        inviterName: inviter?.name ?? "A teammate",
        organizationName: organization?.name ?? "your team",
        role: invitation.role,
        inviteUrl: invitation.inviteUrl
      });

      response.status(201).json({
        invitation,
        emailSent
      });
    }
  );

  app.get(
    "/api/v1/orgs/:orgId/integrations",
    requireAuth,
    requireOrganization(database),
    (request, response) => {
      const organizationId = routeOrganizationId(request)!;
      response.json({
        jira: database.getJiraConnection(organizationId),
        github: database.getGitHubConnection(organizationId)
      });
    }
  );

  app.patch(
    "/api/v1/orgs/:orgId/integrations/jira",
    requireAuth,
    requireOrganization(database, ["owner", "admin"]),
    async (request, response) => {
      const organizationId = routeOrganizationId(request)!;
      const input = validateConnectorInput(request.body ?? {});
      const connector = database.updateJiraConnection(organizationId, {
        secretRef: input.secretRef,
        enabled: input.enabled,
        status: input.enabled ? (input.secretRef ? "connected" : "pending") : "disabled",
        lastValidatedAt: input.enabled ? new Date().toISOString() : null,
        lastError: input.enabled || !input.secretRef ? null : "Connector disabled."
      });

      if (config.backgroundWorkerEnabled) {
        database.createBackgroundJob({
          organizationId,
          jobType: "connector_validation",
          payload: {
            provider: "jira",
            secretRef: connector.secretRef
          }
        });
      } else {
        try {
          await validateConnectorConnection(
            config,
            database,
            logger,
            organizationId,
            "jira",
            connector.secretRef ?? undefined
          );
        } catch {
          // Inline validation already persisted the failure state to the connector record.
        }
      }

      const resolvedConnector =
        config.backgroundWorkerEnabled
          ? connector
          : database.getJiraConnection(organizationId);

      database.recordAuditEvent({
        organizationId,
        actorUserId: request.session.userId!,
        eventType: "connector.updated",
        targetType: "jira_connection",
        targetId: resolvedConnector.id,
        metadata: {
          enabled: resolvedConnector.enabled,
          status: resolvedConnector.status
        }
      });

      response.json({
        connector: resolvedConnector
      });
    }
  );

  app.patch(
    "/api/v1/orgs/:orgId/integrations/github",
    requireAuth,
    requireOrganization(database, ["owner", "admin"]),
    async (request, response) => {
      const organizationId = routeOrganizationId(request)!;
      const input = validateConnectorInput(request.body ?? {});
      const connector = database.updateGitHubConnection(organizationId, {
        secretRef: input.secretRef,
        enabled: input.enabled,
        status: input.enabled ? (input.secretRef ? "connected" : "pending") : "disabled",
        lastValidatedAt: input.enabled ? new Date().toISOString() : null,
        lastError: input.enabled || !input.secretRef ? null : "Connector disabled."
      });

      if (config.backgroundWorkerEnabled) {
        database.createBackgroundJob({
          organizationId,
          jobType: "connector_validation",
          payload: {
            provider: "github",
            secretRef: connector.secretRef
          }
        });
      } else {
        try {
          await validateConnectorConnection(
            config,
            database,
            logger,
            organizationId,
            "github",
            connector.secretRef ?? undefined
          );
        } catch {
          // Inline validation already persisted the failure state to the connector record.
        }
      }

      const resolvedConnector =
        config.backgroundWorkerEnabled
          ? connector
          : database.getGitHubConnection(organizationId);

      database.recordAuditEvent({
        organizationId,
        actorUserId: request.session.userId!,
        eventType: "connector.updated",
        targetType: "github_connection",
        targetId: resolvedConnector.id,
        metadata: {
          enabled: resolvedConnector.enabled,
          status: resolvedConnector.status
        }
      });

      response.json({
        connector: resolvedConnector
      });
    }
  );

  app.get(
    "/api/v1/orgs/:orgId/settings",
    requireAuth,
    requireOrganization(database),
    (request, response) => {
      response.json(database.getOrganizationSettings(routeOrganizationId(request)!));
    }
  );

  app.put(
    "/api/v1/orgs/:orgId/settings",
    requireAuth,
    requireOrganization(database, ["owner", "admin"]),
    (request, response) => {
      const organizationId = routeOrganizationId(request)!;
      const settings = normalizeOrganizationSettingsPayload(request.body ?? {});

      if (settings.trackedRepos.length === 0) {
        throw new AppError("At least one tracked repository is required.", {
          code: "INVALID_REPO_CONFIG",
          statusCode: 400
        });
      }

      const updatedSettings = database.updateOrganizationSettings(organizationId, settings);
      database.recordAuditEvent({
        organizationId,
        actorUserId: request.session.userId!,
        eventType: "organization.settings_updated",
        targetType: "organization_settings",
        targetId: organizationId,
        metadata: {
          teamMemberCount: updatedSettings.teamMembers.length,
          trackedRepoCount: updatedSettings.trackedRepos.length
        }
      });

      response.json(updatedSettings);
    }
  );

  app.get(
    ["/api/history", "/api/v1/orgs/:orgId/query-runs"],
    requireAuth,
    (request, response, next) => {
      try {
        const snapshot = buildSessionSnapshot(request, database, config);
        const organization =
          routeOrganizationId(request)
            ? database.getOrganizationForUser(request.session.userId!, routeOrganizationId(request)!)
            : snapshot.currentOrganization;

        if (!organization) {
          throw new AppError("No active organization is available.", {
            code: "NO_ORGANIZATION",
            statusCode: 403
          });
        }

        request.session.currentOrganizationId = organization.id;
        response.json({
          items: database.listRecentQueryRuns(organization.id, 12)
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    "/api/v1/orgs/:orgId/audit-events",
    requireAuth,
    requireOrganization(database, ["owner", "admin", "support"]),
    (request, response) => {
      response.json({
        items: database.listAuditEvents(routeOrganizationId(request)!, 20)
      });
    }
  );

  app.get(
    "/api/v1/orgs/:orgId/background-jobs",
    requireAuth,
    requireOrganization(database, ["owner", "admin", "support"]),
    (request, response) => {
      response.json({
        items: database.listBackgroundJobs(routeOrganizationId(request)!, 12)
      });
    }
  );

  app.post(
    ["/api/query", "/api/v1/orgs/:orgId/query"],
    requireAuth,
    requireProviderConnections(database, ["github", "jira"], (providerAuth) =>
      applyProviderAuthRuntime(config, providerAuth)
    ),
    async (request, response) => {
      const snapshot = buildSessionSnapshot(request, database, config);
      const organization =
        routeOrganizationId(request)
          ? database.getOrganizationForUser(request.session.userId!, routeOrganizationId(request)!)
          : snapshot.currentOrganization;

      if (!organization) {
        throw new AppError("No active organization is available for querying.", {
          code: "NO_ORGANIZATION",
          statusCode: 403
        });
      }

      request.session.currentOrganizationId = organization.id;

      const requestLogger = logger.child({
        route: request.params.orgId ? "/api/v1/orgs/:orgId/query" : "/api/query",
        requestId:
          typeof request.id === "string"
            ? request.id
            : typeof request.headers["x-request-id"] === "string"
              ? request.headers["x-request-id"]
              : undefined,
        userId: request.session.userId,
        organizationId: organization.id,
        organizationSlug: organization.slug
      });

      const query = typeof request.body?.query === "string" ? request.body.query.trim() : "";

      if (!query) {
        throw new AppError("A non-empty query is required.", {
          code: "EMPTY_QUERY",
          statusCode: 400
        });
      }

      const parsedQuery = parseQuery(query, config.appTimezone);
      const orgSettings = database.getOrganizationSettings(organization.id);
      const jiraConnection = database.getJiraConnection(organization.id);
      const githubConnection = database.getGitHubConnection(organization.id);

      const adjustedParsedQuery = filteredParsedQuery(parsedQuery, {
        jiraEnabled: jiraConnection.enabled,
        githubEnabled: githubConnection.enabled
      });
      const executionConfig = {
        ...config,
        teamMembers: orgSettings.teamMembers,
        trackedRepos: orgSettings.trackedRepos
      };
      const identity = resolveIdentity(
        adjustedParsedQuery.memberText,
        adjustedParsedQuery.rawQuery,
        executionConfig.teamMembers
      );

      requestLogger.info(
        {
          query,
          intent: adjustedParsedQuery.intent,
          requestedSources: adjustedParsedQuery.requestedSources,
          timeframe: adjustedParsedQuery.timeframe.label,
          memberText: adjustedParsedQuery.memberText
        },
        "Received organization activity query"
      );

      const [userGitHubToken, userJiraToken] = await Promise.all([
        getActiveProviderToken(request.session.userId!, "github", config, database, requestLogger),
        getActiveProviderToken(request.session.userId!, "jira", config, database, requestLogger)
      ]);
      const userJiraConnection = database.getUserProviderConnection(request.session.userId!, "jira");
      const jiraSiteId = userJiraConnection?.metadata?.siteId as string | undefined;

      const summary = await buildActivitySummary(
        executionConfig,
        adjustedParsedQuery,
        identity,
        requestLogger,
        {
          githubToken: userGitHubToken,
          jiraToken: userJiraToken,
          jiraSiteId
        }
      );

      summary.integration = {
        jira: buildWorkspaceProviderIntegration(
          "Jira",
          jiraConnection.enabled,
          parsedQuery.requestedSources.includes("jira"),
          adjustedParsedQuery.requestedSources.includes("jira"),
          Boolean(userJiraToken)
        ),
        github: buildWorkspaceProviderIntegration(
          "GitHub",
          githubConnection.enabled,
          parsedQuery.requestedSources.includes("github"),
          adjustedParsedQuery.requestedSources.includes("github"),
          Boolean(userGitHubToken)
        )
      };

      if (!jiraConnection.enabled && parsedQuery.requestedSources.includes("jira")) {
        summary.caveats.push("Jira is disabled for this organization, so Jira data was skipped.");
      }

      if (!githubConnection.enabled && parsedQuery.requestedSources.includes("github")) {
        summary.caveats.push(
          "GitHub is disabled for this organization, so GitHub data was skipped."
        );
      }

      // Route to the provider determined by the model ID prefix.
      // All model IDs ("gateway:*", "local:*", "openai:*", "claude:*", "gemini:*") are handled by
      // LlmService → LlmProviderRegistry → adapter. No silent Ollama fallback.
      const requestedModelId =
        typeof request.body?.modelId === "string" ? request.body.modelId.trim() : "";
      // When no model is explicitly selected, use the configured default system model.
      const effectiveModelId = requestedModelId || executionConfig.defaultModelId;

      const chatResp = await llmService.chat(request.session.userId!, {
        modelId: effectiveModelId,
        messages: [
          { role: "system", content: RESPONSE_SYSTEM_PROMPT },
          { role: "user", content: buildGroundedResponsePrompt(summary) }
        ]
      });
      const responseText = chatResp.message.content;
      const modelUsed = effectiveModelId;
      requestLogger.info({ modelId: effectiveModelId }, "Generated grounded response via LLM service");

      const queryRun = database.saveQueryRun({
        organizationId: organization.id,
        userId: request.session.userId!,
        queryText: query,
        responseText,
        summary
      });

      database.recordAuditEvent({
        organizationId: organization.id,
        actorUserId: request.session.userId!,
        eventType: "query.executed",
        targetType: "query_run",
        targetId: queryRun.id,
        metadata: {
          intent: adjustedParsedQuery.intent,
          needsClarification: summary.needsClarification
        }
      });

      response.json({
        organization,
        query,
        parsedQuery: adjustedParsedQuery,
        summary,
        responseText,
        modelUsed,
        connectorStatus: {
          jira: jiraConnection,
          github: githubConnection
        },
        partialData:
          !summary.jira.status.ok ||
          !summary.github.status.ok ||
          summary.github.status.partial,
        staleData:
          jiraConnection.status === "needs_attention" ||
          githubConnection.status === "needs_attention"
      });
    }
  );

  // ── Dashboard Aggregation Endpoints ──────────────────────────────────────

  app.get(
    "/api/v1/orgs/:orgId/dashboard/github",
    requireAuth,
    requireOrganization(database),
    async (request, response) => {
      const organizationId = routeOrganizationId(request)!;
      const orgSettings = database.getOrganizationSettings(organizationId);
      const executionConfig = {
        ...config,
        teamMembers: orgSettings.teamMembers,
        trackedRepos: orgSettings.trackedRepos
      };
      const data = await fetchGitHubDashboard(
        executionConfig,
        orgSettings.teamMembers,
        orgSettings.trackedRepos,
        logger
      );
      response.json(data);
    }
  );

  app.get(
    "/api/v1/orgs/:orgId/dashboard/jira",
    requireAuth,
    requireOrganization(database),
    async (request, response) => {
      const organizationId = routeOrganizationId(request)!;
      const orgSettings = database.getOrganizationSettings(organizationId);
      const executionConfig = {
        ...config,
        teamMembers: orgSettings.teamMembers,
        trackedRepos: orgSettings.trackedRepos
      };
      const data = await fetchJiraDashboard(
        executionConfig,
        orgSettings.teamMembers,
        logger
      );
      response.json(data);
    }
  );

  app.post(
    "/api/v1/orgs/:orgId/dashboard/insight",
    requireAuth,
    requireOrganization(database),
    async (request, response) => {
      const github = (request.body?.github ?? null) as import("./types/dashboard.js").GitHubDashboardData | null;
      const jira = (request.body?.jira ?? null) as import("./types/dashboard.js").JiraDashboardData | null;
      const text = await generateDashboardInsight(config, github, jira, logger);
      response.json({
        text,
        generatedAt: new Date().toISOString(),
        error: text === null ? "AI insight unavailable — ensure Ollama is running." : null
      });
    }
  );

  // ── Webhook Routes ────────────────────────────────────────────────────────
  // Webhooks require the raw body for HMAC verification. We mount them AFTER
  // express.json() so that normal routes get parsed JSON, but the webhook routes
  // get raw Buffer via a per-route middleware.

  const cache: ActivityCache = getSharedCache();

  const rawBodyCapture = express.raw({ type: "application/json", limit: "2mb" });

  // GitHub webhooks bypass CSRF (they come from GitHub, not a browser session)
  const githubWebhookHandler = createGitHubWebhookHandler(database, cache, logger);
  app.post("/webhooks/github", rawBodyCapture, (req, _res, next) => {
    // Attach raw body for HMAC verification; re-parse JSON for event handling
    const raw = req as express.Request & { rawBody?: Buffer };
    if (Buffer.isBuffer(req.body)) {
      raw.rawBody = req.body;
      try {
        (req as express.Request & { body: unknown }).body = JSON.parse(req.body.toString("utf8")) as unknown;
      } catch {
        (req as express.Request & { body: unknown }).body = {};
      }
    }
    next();
  }, githubWebhookHandler);

  const jiraWebhookHandler = createJiraWebhookHandler(database, cache, logger);
  app.post("/webhooks/jira", jiraWebhookHandler);

  // ── Chat Endpoint ──────────────────────────────────────────────────────────
  // Stateless per-request tool-first chat. Conversation history is passed
  // by the client (simple array of messages). Sessions in SQLite are out of
  // scope for the MVP — clients hold history in-memory.

  app.post(
    "/api/v1/chat",
    requireAuth,
    requireOrganization(database),
    async (request, response) => {
      const { userId, currentOrganizationId } = request.session;
      if (!userId || !currentOrganizationId) {
        response.status(401).json({ error: "Not authenticated" });
        return;
      }

      const bodySchema = z.object({
        message: z.string().min(1).max(4096),
        modelId: z.string().min(1),
        conversationId: z.string().optional(),
        history: z.array(z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string()
        })).max(50).default([])
      });

      const parsed = bodySchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: "Invalid request", details: parsed.error.issues });
        return;
      }

      const { message, modelId, conversationId, history: rawHistory } = parsed.data;

      const organization = database.getOrganizationForUser(userId, currentOrganizationId);
      if (!organization) {
        response.status(404).json({ error: "Organization not found" });
        return;
      }

      const orgSettings = database.getOrganizationSettings(organization.id);
      const executionConfig = { ...config, teamMembers: orgSettings.teamMembers, trackedRepos: orgSettings.trackedRepos };

      // Load OAuth tokens
      const [userGitHubToken, userJiraToken] = await Promise.all([
        getActiveProviderToken(userId, "github", config, database, logger),
        getActiveProviderToken(userId, "jira", config, database, logger)
      ]);
      const userJiraConnection = database.getUserProviderConnection(userId, "jira");
      const jiraSiteId = userJiraConnection?.metadata?.siteId as string | undefined;

      // Reconstruct conversation history (user+assistant only — tool turns are internal)
      const history: NormalizedChatMessage[] = rawHistory.map((m) => ({
        role: m.role,
        content: m.content
      }));

      const requestLogger = logger.child({ userId, orgId: organization.id, route: "chat" });

      try {
        const result = await runChatTurn(message, history, llmService, {
          userId,
          organizationId: organization.id,
          modelId,
          timezone: config.appTimezone,
          githubToken: userGitHubToken,
          jiraToken: userJiraToken,
          jiraSiteId,
          teamMembers: orgSettings.teamMembers,
          config: executionConfig,
          database,
          logger: requestLogger,
          cache
        });

        // Persist messages if a conversationId was provided
        let activeConversationId = conversationId;
        try {
          if (activeConversationId) {
            database.addMessage({ conversationId: activeConversationId, role: "user", content: message });
            database.addMessage({
              conversationId: activeConversationId,
              role: "assistant",
              content: result.answer,
              metadata: {
                toolsUsed: result.toolsUsed,
                sources: result.sources,
                tokenUsage: result.tokenUsage,
                totalLatencyMs: result.totalLatencyMs,
                artifactSuggestions: result.artifactSuggestions,
              },
            });
          }
        } catch {
          // Non-fatal: message persistence should not break the response
        }

        // Log to audit trail
        try {
          database.recordAuditEvent({
            organizationId: organization.id,
            actorUserId: userId,
            eventType: "chat.turn",
            targetType: "query",
            metadata: {
              conversationId: activeConversationId,
              toolsUsed: result.toolsUsed,
              tokenUsage: result.tokenUsage,
              latencyMs: result.totalLatencyMs,
              partialFailures: result.partialFailures.length
            }
          });
        } catch {
          // Non-fatal
        }

        response.json({ ...result, conversationId: activeConversationId });
      } catch (err) {
        requestLogger.error({ err }, "Chat turn failed");
        response.status(500).json({
          error: toErrorMessage(err),
          code: "CHAT_PIPELINE_ERROR"
        });
      }
    }
  );

  // ── Error Handler ─────────────────────────────────────────────────────────

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction
    ) => {
      if (isAppError(error)) {
        response.status(error.statusCode).json({
          error: error.message,
          code: error.code
        });
        return;
      }

      response.status(500).json({
        error: error instanceof Error ? error.message : "Unexpected server error."
      });
    }
  );

  return app;
}
