import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { initializeDatabase } from "../src/db.js";
import { logger } from "../src/lib/logger.js";
import { buildTestConfig, cleanupTestConfig, mockLocalModelResponse } from "./helpers.js";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function extractQueryParam(location: string, key: string): string | null {
  return new URL(location).searchParams.get(key);
}

function mockGitHubOAuthResponses(
  overrides: {
    email?: string;
    login?: string;
    name?: string;
  } = {}
) {
  vi.restoreAllMocks();

  const email = overrides.email ?? "octo@example.com";
  const login = overrides.login ?? "octocat";
  const name = overrides.name ?? "Octo Cat";
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      jsonResponse({
        access_token: "github-access-token",
        token_type: "bearer",
        scope: "read:user user:email"
      })
    )
    .mockResolvedValueOnce(
      jsonResponse({
        id: 101,
        login,
        name,
        email: null,
        html_url: "https://github.com/octocat"
      })
    )
    .mockResolvedValueOnce(
      jsonResponse([
        {
          email,
          primary: true,
          verified: true
        }
      ])
    );
}

function mockJiraOAuthResponses(
  overrides: {
    email?: string;
    name?: string;
    nickname?: string;
    baseUrl?: string;
  } = {}
) {
  vi.restoreAllMocks();

  const email = overrides.email ?? "jira.user@example.com";
  const name = overrides.name ?? "Jira User";
  const nickname = overrides.nickname ?? "jira-user";
  const baseUrl = overrides.baseUrl ?? "https://your-domain.atlassian.net";
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      jsonResponse({
        access_token: "jira-access-token",
        scope: "read:me read:jira-user offline_access",
        expires_in: 3600
      })
    )
    .mockResolvedValueOnce(
      jsonResponse({
        account_id: "jira-account-123",
        email,
        name,
        nickname
      })
    )
    .mockResolvedValueOnce(
      jsonResponse([
        {
          id: "cloud-123",
          name: "Example Jira",
          url: baseUrl,
          scopes: ["read:me", "read:jira-user"]
        }
      ])
    );
}

async function getCsrf(agent: ReturnType<typeof request.agent>) {
  const response = await agent.get("/api/v1/auth/session");
  return response.body.csrfToken as string;
}

async function postWithCsrf(
  agent: ReturnType<typeof request.agent>,
  path: string,
  payload: Record<string, unknown>
) {
  const csrfToken = await getCsrf(agent);
  return agent.post(path).set("x-csrf-token", csrfToken).send(payload);
}

async function patchWithCsrf(
  agent: ReturnType<typeof request.agent>,
  path: string,
  payload: Record<string, unknown>
) {
  const csrfToken = await getCsrf(agent);
  return agent.patch(path).set("x-csrf-token", csrfToken).send(payload);
}

async function putWithCsrf(
  agent: ReturnType<typeof request.agent>,
  path: string,
  payload: Record<string, unknown>
) {
  const csrfToken = await getCsrf(agent);
  return agent.put(path).set("x-csrf-token", csrfToken).send(payload);
}

async function connectProvider(
  agent: ReturnType<typeof request.agent>,
  provider: "github" | "jira"
) {
  const csrfToken = await getCsrf(agent);
  return agent
    .post(`/api/v1/auth/providers/${provider}/demo-connect`)
    .set("x-csrf-token", csrfToken)
    .send({});
}

async function signInWithProvider(
  agent: ReturnType<typeof request.agent>,
  provider: "github" | "jira",
  payload: {
    email: string;
    name?: string;
    organizationName?: string;
  }
) {
  const csrfToken = await getCsrf(agent);
  return agent
    .post(`/api/v1/auth/providers/${provider}/login`)
    .set("x-csrf-token", csrfToken)
    .send(payload);
}

describe("enterprise api routes", () => {
  beforeEach(() => {
    mockLocalModelResponse();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function buildAuthenticatedAgent(overrides: Record<string, string | undefined> = {}) {
    const config = buildTestConfig(overrides);
    const database = initializeDatabase(config);
    const app = createApp(config, logger.child({ test: "auth-agent" }), database);
    const agent = request.agent(app);

    const registrationResponse = await postWithCsrf(agent, "/api/v1/auth/register", {
      name: "Test User",
      email: `test-${Date.now()}@example.com`,
      password: "supersecurepassword",
      organizationName: "Acme Operations"
    });

    const organizationId = registrationResponse.body.currentOrganization.id as string;

    return {
      config,
      database,
      agent,
      organizationId
    };
  }

  it("creates an owner organization during registration", async () => {
    const { config, database, agent, organizationId } = await buildAuthenticatedAgent();
    const sessionResponse = await agent.get("/api/v1/auth/session");

    expect(sessionResponse.status).toBe(200);
    expect(sessionResponse.body.authenticated).toBe(true);
    expect(sessionResponse.body.currentOrganization.id).toBe(organizationId);
    expect(sessionResponse.body.currentOrganization.role).toBe("owner");
    expect(sessionResponse.body.providerAuth.allConnected).toBe(false);
    expect(sessionResponse.body.providerAuth.missingProviders).toEqual(["github", "jira"]);

    database.close();
    cleanupTestConfig(config);
  });

  it("redirects to GitHub OAuth when that provider is configured", async () => {
    const config = buildTestConfig({
      GITHUB_OAUTH_CLIENT_ID: "github-client-id",
      GITHUB_OAUTH_CLIENT_SECRET: "github-client-secret"
    });
    const database = initializeDatabase(config);
    const app = createApp(config, logger.child({ test: "github-oauth-start" }), database);
    const agent = request.agent(app);

    const sessionResponse = await agent.get("/api/v1/auth/session");
    expect(sessionResponse.body.providerAuth.providerModes.github).toBe("oauth");
    expect(sessionResponse.body.providerAuth.providerModes.jira).toBe("demo");

    const response = await agent.get("/api/v1/auth/providers/github/start");

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("https://github.com/login/oauth/authorize");
    expect(extractQueryParam(response.headers.location, "client_id")).toBe("github-client-id");
    expect(extractQueryParam(response.headers.location, "state")).toBeTruthy();
    expect(extractQueryParam(response.headers.location, "code_challenge")).toBeTruthy();
    expect(extractQueryParam(response.headers.location, "redirect_uri")).toBe(
      "http://localhost:3000/api/v1/auth/providers/github/callback"
    );

    database.close();
    cleanupTestConfig(config);
  });

  it("creates a new account and connects the selected provider from the login page flow", async () => {
    const config = buildTestConfig();
    const database = initializeDatabase(config);
    const app = createApp(config, logger.child({ test: "provider-login-new-user" }), database);
    const agent = request.agent(app);

    const response = await signInWithProvider(agent, "github", {
      email: "octo@example.com",
      name: "Octo Example",
      organizationName: "Octo Ops"
    });

    expect(response.status).toBe(201);
    expect(response.body.authenticated).toBe(true);
    expect(response.body.createdAccount).toBe(true);
    expect(response.body.currentOrganization.name).toBe("Octo Ops");
    expect(response.body.providerAuth.github.status).toBe("connected");
    expect(response.body.providerAuth.missingProviders).toEqual(["jira"]);

    const createdUser = database.findUserByEmail("octo@example.com");
    expect(createdUser?.name).toBe("Octo Example");

    database.close();
    cleanupTestConfig(config);
  });

  it("signs an existing user in through provider auth without requiring a password", async () => {
    const config = buildTestConfig();
    const database = initializeDatabase(config);
    const app = createApp(config, logger.child({ test: "provider-login-existing-user" }), database);
    const agent = request.agent(app);

    const registrationResponse = await postWithCsrf(agent, "/api/v1/auth/register", {
      name: "Existing User",
      email: "existing@example.com",
      password: "supersecurepassword",
      organizationName: "Existing Workspace"
    });

    const organizationId = registrationResponse.body.currentOrganization.id as string;
    const logoutResponse = await postWithCsrf(agent, "/api/v1/auth/logout", {});
    expect(logoutResponse.status).toBe(200);

    const providerLoginResponse = await signInWithProvider(agent, "jira", {
      email: "existing@example.com"
    });

    expect(providerLoginResponse.status).toBe(200);
    expect(providerLoginResponse.body.authenticated).toBe(true);
    expect(providerLoginResponse.body.createdAccount).toBe(false);
    expect(providerLoginResponse.body.currentOrganization.id).toBe(organizationId);
    expect(providerLoginResponse.body.providerAuth.jira.status).toBe("connected");

    const queryBlocked = await postWithCsrf(agent, `/api/v1/orgs/${organizationId}/query`, {
      query: "What is John working on these days?"
    });

    expect(queryBlocked.status).toBe(403);
    expect(queryBlocked.body.providerAuth.missingProviders).toEqual(["github"]);

    database.close();
    cleanupTestConfig(config);
  });

  it("links GitHub OAuth to an existing signed-in user", async () => {
    const { config, database, agent } = await buildAuthenticatedAgent({
      GITHUB_OAUTH_CLIENT_ID: "github-client-id",
      GITHUB_OAUTH_CLIENT_SECRET: "github-client-secret"
    });

    const startResponse = await agent.get("/api/v1/auth/providers/github/start");
    const state = extractQueryParam(startResponse.headers.location, "state");
    expect(startResponse.status).toBe(302);
    expect(state).toBeTruthy();

    mockGitHubOAuthResponses({
      email: "linked-user@example.com",
      login: "linked-user",
      name: "Linked User"
    });

    const callbackResponse = await agent.get(
      `/api/v1/auth/providers/github/callback?code=test-code&state=${state}`
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.location).toContain("/app?provider_auth=connected&provider=github");

    const sessionResponse = await agent.get("/api/v1/auth/session");
    expect(sessionResponse.body.providerAuth.github.status).toBe("connected");
    expect(sessionResponse.body.providerAuth.github.authMethod).toBe("oauth");
    expect(sessionResponse.body.providerAuth.github.login).toBe("linked-user");

    database.close();
    cleanupTestConfig(config);
  });

  it("creates a local account from GitHub OAuth when the user starts unauthenticated", async () => {
    const config = buildTestConfig({
      GITHUB_OAUTH_CLIENT_ID: "github-client-id",
      GITHUB_OAUTH_CLIENT_SECRET: "github-client-secret"
    });
    const database = initializeDatabase(config);
    const app = createApp(config, logger.child({ test: "github-oauth-login" }), database);
    const agent = request.agent(app);

    const startResponse = await agent.get("/api/v1/auth/providers/github/start");
    const state = extractQueryParam(startResponse.headers.location, "state");

    mockGitHubOAuthResponses({
      email: "new-github-user@example.com",
      login: "new-github-user",
      name: "New GitHub User"
    });

    const callbackResponse = await agent.get(
      `/api/v1/auth/providers/github/callback?code=test-code&state=${state}`
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.location).toContain("/app?provider_auth=connected&provider=github");

    const sessionResponse = await agent.get("/api/v1/auth/session");
    expect(sessionResponse.body.authenticated).toBe(true);
    expect(sessionResponse.body.user.email).toBe("new-github-user@example.com");
    expect(sessionResponse.body.providerAuth.github.status).toBe("connected");

    const createdUser = database.findUserByEmail("new-github-user@example.com");
    expect(createdUser?.name).toBe("New GitHub User");

    database.close();
    cleanupTestConfig(config);
  });

  it("links Jira OAuth to an existing signed-in user", async () => {
    const { config, database, agent } = await buildAuthenticatedAgent({
      JIRA_OAUTH_CLIENT_ID: "jira-client-id",
      JIRA_OAUTH_CLIENT_SECRET: "jira-client-secret",
      JIRA_BASE_URL: "https://your-domain.atlassian.net"
    });

    const startResponse = await agent.get("/api/v1/auth/providers/jira/start");
    const state = extractQueryParam(startResponse.headers.location, "state");
    expect(startResponse.status).toBe(302);
    expect(startResponse.headers.location).toContain("https://auth.atlassian.com/authorize");
    expect(state).toBeTruthy();

    mockJiraOAuthResponses({
      email: "jira-linked@example.com",
      name: "Jira Linked",
      nickname: "jira-linked",
      baseUrl: "https://your-domain.atlassian.net"
    });

    const callbackResponse = await agent.get(
      `/api/v1/auth/providers/jira/callback?code=test-code&state=${state}`
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.location).toContain("/app?provider_auth=connected&provider=jira");

    const sessionResponse = await agent.get("/api/v1/auth/session");
    expect(sessionResponse.body.providerAuth.jira.status).toBe("connected");
    expect(sessionResponse.body.providerAuth.jira.authMethod).toBe("oauth");
    expect(sessionResponse.body.providerAuth.jira.email).toBe("jira-linked@example.com");

    database.close();
    cleanupTestConfig(config);
  });

  it("requires both provider sign-ins before running org queries", async () => {
    const { config, database, agent, organizationId } = await buildAuthenticatedAgent();

    const blockedResponse = await postWithCsrf(agent, `/api/v1/orgs/${organizationId}/query`, {
      query: "What is John working on these days?"
    });

    expect(blockedResponse.status).toBe(403);
    expect(blockedResponse.body.code).toBe("PROVIDER_AUTH_REQUIRED");
    expect(blockedResponse.body.providerAuth.missingProviders).toEqual(["github", "jira"]);

    database.close();
    cleanupTestConfig(config);
  });

  it("returns a grounded org-scoped response after both providers are connected", async () => {
    const { config, database, agent, organizationId } = await buildAuthenticatedAgent();

    const githubConnect = await connectProvider(agent, "github");
    const jiraConnect = await connectProvider(agent, "jira");

    expect(githubConnect.status).toBe(200);
    expect(jiraConnect.status).toBe(200);

    const response = await postWithCsrf(agent, `/api/v1/orgs/${organizationId}/query`, {
      query: "What is John working on these days?"
    });

    expect(response.status).toBe(200);
    expect(response.body.responseText).toContain("Overview:");
    expect(response.body.summary.member.displayName).toBe("John Doe");
    expect(response.body.organization.id).toBe(organizationId);

    database.close();
    cleanupTestConfig(config);
  });

  it("requires auth for protected org query access", async () => {
    const config = buildTestConfig();
    const database = initializeDatabase(config);
    const app = createApp(config, logger.child({ test: "api-requires-auth" }), database);
    const agent = request.agent(app);
    const response = await postWithCsrf(agent, "/api/v1/orgs/not-real/query", {
      query: "What is John working on these days?"
    });

    expect(response.status).toBe(401);

    database.close();
    cleanupTestConfig(config);
  });

  it("creates invitations and records audit events for owners", async () => {
    const { config, database, agent, organizationId } = await buildAuthenticatedAgent();

    const invitationResponse = await postWithCsrf(
      agent,
      `/api/v1/orgs/${organizationId}/invitations`,
      {
        email: "invitee@example.com",
        role: "member"
      }
    );

    expect(invitationResponse.status).toBe(201);
    expect(invitationResponse.body.invitation.inviteUrl).toContain("/register?invite=");

    const auditResponse = await agent.get(`/api/v1/orgs/${organizationId}/audit-events`);

    expect(auditResponse.status).toBe(200);
    expect(auditResponse.body.items.some((item: { eventType: string }) => item.eventType === "invitation.created")).toBe(true);

    database.close();
    cleanupTestConfig(config);
  });

  it("updates connectors and workspace settings", async () => {
    const { config, database, agent, organizationId } = await buildAuthenticatedAgent();

    const connectorResponse = await patchWithCsrf(
      agent,
      `/api/v1/orgs/${organizationId}/integrations/jira`,
      {
        secretRef: "prod/tam/jira",
        enabled: true
      }
    );

    expect(connectorResponse.status).toBe(200);
    expect(connectorResponse.body.connector.secretRef).toBe("prod/tam/jira");

    const settingsResponse = await putWithCsrf(
      agent,
      `/api/v1/orgs/${organizationId}/settings`,
      {
        teamMembers: [
          {
            id: "john-doe",
            displayName: "John Doe",
            aliases: ["john", "john doe"],
            githubUsername: "john-doe"
          }
        ],
        trackedRepos: [
          {
            owner: "acme",
            repo: "team-portal"
          }
        ]
      }
    );

    expect(settingsResponse.status).toBe(200);
    expect(settingsResponse.body.teamMembers.length).toBe(1);
    expect(settingsResponse.body.trackedRepos.length).toBe(1);

    database.close();
    cleanupTestConfig(config);
  });
});
