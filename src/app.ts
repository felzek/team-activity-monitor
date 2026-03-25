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
import { AppError, isAppError } from "./lib/errors.js";
import { createHttpLogger } from "./lib/logger.js";
import { generateGroundedResponse } from "./lib/ollama.js";
import { createRateLimitMiddleware } from "./lib/rate-limit.js";
import { buildActivitySummary } from "./orchestrator/activity.js";
import { resolveIdentity } from "./query/identity.js";
import { parseQuery } from "./query/parser.js";
import type { OrganizationSettings, OrganizationSummary, SessionSnapshot } from "./types/auth.js";
import type { ParsedQuery } from "./types/activity.js";

function publicFile(fileName: string): string {
  return path.resolve(process.cwd(), "public", fileName);
}

function applySecurityHeaders(app: express.Express): void {
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
        "script-src 'self'",
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
      providerAuth: withProviderAuthMode({
        mode: "demo",
        requiredProviders: ["github", "jira"],
        missingProviders: ["github", "jira"],
        allConnected: false,
        jira: null,
        github: null
      }, config)
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
      providerAuth: withProviderAuthMode({
        mode: "demo",
        requiredProviders: ["github", "jira"],
        missingProviders: ["github", "jira"],
        allConnected: false,
        jira: null,
        github: null
      }, config)
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
    providerAuth: withProviderAuthMode(database.getProviderAuthRequirement(userId), config)
  };
}

function providerAuthMode(config: AppConfig): "demo" | "external_required" {
  return config.useRecordedFixtures || config.appEnv !== "production"
    ? "demo"
    : "external_required";
}

function withProviderAuthMode(
  providerAuth: SessionSnapshot["providerAuth"],
  config: AppConfig
): SessionSnapshot["providerAuth"] {
  return {
    ...providerAuth,
    mode: providerAuthMode(config)
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

export function createApp(config: AppConfig, logger: Logger, database: AppDatabase) {
  const app = express();

  applySecurityHeaders(app);
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
        secure: config.appEnv === "production",
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

  app.get("/", (_request, response) => {
    response.sendFile(publicFile("index.html"));
  });

  app.get("/login", redirectAuthenticatedPage, (_request, response) => {
    response.sendFile(publicFile("login.html"));
  });

  app.get("/register", redirectAuthenticatedPage, (_request, response) => {
    response.sendFile(publicFile("register.html"));
  });

  app.get("/app", requireAuthPage, (_request, response) => {
    response.sendFile(publicFile("dashboard.html"));
  });

  app.get("/docs", (_request, response) => {
    response.sendFile(publicFile("docs.html"));
  });

  app.get("/security", (_request, response) => {
    response.sendFile(publicFile("security.html"));
  });

  app.get("/status", (_request, response) => {
    response.sendFile(publicFile("status.html"));
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

  app.get(["/api/auth/session", "/api/v1/auth/session"], (request, response) => {
    response.json(buildSessionSnapshot(request, database, config));
  });

  app.get("/api/v1/auth/providers", requireAuth, (request, response) => {
    response.json({
      providerAuth: withProviderAuthMode(
        database.getProviderAuthRequirement(request.session.userId!),
        config
      )
    });
  });

  app.post("/api/v1/auth/providers/:provider/demo-connect", requireAuth, (request, response) => {
    if (providerAuthMode(config) !== "demo") {
      throw new AppError("Demo provider sign-in is disabled in this environment.", {
        code: "PROVIDER_AUTH_MODE_UNAVAILABLE",
        statusCode: 501
      });
    }

    const provider = validateProviderParam(
      Array.isArray(request.params.provider)
        ? request.params.provider[0]
        : request.params.provider ?? ""
    );
    const user = database.findUserById(request.session.userId!);

    if (!user) {
      throw new AppError("Signed-in user could not be found.", {
        code: "USER_NOT_FOUND",
        statusCode: 404
      });
    }

    const fallbackLogin =
      provider === "github"
        ? user.email.split("@")[0].toLowerCase().replace(/[^a-z0-9-]/g, "-")
        : user.email.toLowerCase();
    const connector = database.upsertUserProviderConnection(user.id, provider, {
      status: "connected",
      externalAccountId: `${provider}:${user.id}`,
      displayName: user.name,
      login: fallbackLogin,
      email: user.email,
      authMethod: "demo",
      connectedAt: new Date().toISOString(),
      metadata: {
        mode: "demo",
        connectedByUserId: user.id
      }
    });
    const organizations = database.listUserOrganizations(user.id);
    const organization = requireActiveOrganization(request, organizations);

    database.recordAuditEvent({
      organizationId: organization.id,
      actorUserId: user.id,
      eventType: "provider_auth.connected",
      targetType: `${provider}_auth`,
      targetId: connector.id,
      metadata: {
        provider,
        authMethod: "demo"
      }
    });

    response.json({
      connector,
      providerAuth: withProviderAuthMode(database.getProviderAuthRequirement(user.id), config)
    });
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
      providerAuth: withProviderAuthMode(database.getProviderAuthRequirement(userId), config)
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
      response.json({
        items: database.listOrganizationMembers(organizationId)
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
        items: database.listInvitations(organizationId, config.appBaseUrl)
      });
    }
  );

  app.post(
    "/api/v1/orgs/:orgId/invitations",
    requireAuth,
    requireOrganization(database, ["owner", "admin"]),
    (request, response) => {
      const organizationId = routeOrganizationId(request)!;
      const input = validateInviteInput(request.body ?? {});
      const invitation = database.createInvitation({
        organizationId,
        email: input.email,
        role: input.role,
        createdByUserId: request.session.userId!,
        baseUrl: config.appBaseUrl
      });

      database.recordAuditEvent({
        organizationId,
        actorUserId: request.session.userId!,
        eventType: "invitation.created",
        targetType: "invitation",
        targetId: invitation.id,
        metadata: {
          email: invitation.email,
          role: invitation.role
        }
      });

      response.status(201).json({
        invitation
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
    (request, response) => {
      const organizationId = routeOrganizationId(request)!;
      const input = validateConnectorInput(request.body ?? {});
      const connector = database.updateJiraConnection(organizationId, {
        secretRef: input.secretRef,
        enabled: input.enabled,
        status: input.enabled ? (input.secretRef ? "connected" : "pending") : "disabled",
        lastValidatedAt: input.enabled ? new Date().toISOString() : null,
        lastError: input.enabled || !input.secretRef ? null : "Connector disabled."
      });

      database.createBackgroundJob({
        organizationId,
        jobType: "connector_validation",
        payload: {
          provider: "jira",
          secretRef: connector.secretRef
        }
      });

      database.recordAuditEvent({
        organizationId,
        actorUserId: request.session.userId!,
        eventType: "connector.updated",
        targetType: "jira_connection",
        targetId: connector.id,
        metadata: {
          enabled: connector.enabled,
          status: connector.status
        }
      });

      response.json({
        connector
      });
    }
  );

  app.patch(
    "/api/v1/orgs/:orgId/integrations/github",
    requireAuth,
    requireOrganization(database, ["owner", "admin"]),
    (request, response) => {
      const organizationId = routeOrganizationId(request)!;
      const input = validateConnectorInput(request.body ?? {});
      const connector = database.updateGitHubConnection(organizationId, {
        secretRef: input.secretRef,
        enabled: input.enabled,
        status: input.enabled ? (input.secretRef ? "connected" : "pending") : "disabled",
        lastValidatedAt: input.enabled ? new Date().toISOString() : null,
        lastError: input.enabled || !input.secretRef ? null : "Connector disabled."
      });

      database.createBackgroundJob({
        organizationId,
        jobType: "connector_validation",
        payload: {
          provider: "github",
          secretRef: connector.secretRef
        }
      });

      database.recordAuditEvent({
        organizationId,
        actorUserId: request.session.userId!,
        eventType: "connector.updated",
        targetType: "github_connection",
        targetId: connector.id,
        metadata: {
          enabled: connector.enabled,
          status: connector.status
        }
      });

      response.json({
        connector
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
    requireProviderConnections(database, ["github", "jira"], providerAuthMode(config)),
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

      const summary = await buildActivitySummary(
        executionConfig,
        adjustedParsedQuery,
        identity,
        requestLogger
      );

      if (!jiraConnection.enabled && parsedQuery.requestedSources.includes("jira")) {
        summary.caveats.push("Jira is disabled for this organization, so Jira data was skipped.");
      }

      if (!githubConnection.enabled && parsedQuery.requestedSources.includes("github")) {
        summary.caveats.push(
          "GitHub is disabled for this organization, so GitHub data was skipped."
        );
      }

      const responseText = await generateGroundedResponse(executionConfig, summary, requestLogger);

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
