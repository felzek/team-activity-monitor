import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { initializeDatabase } from "../src/db.js";
import { logger } from "../src/lib/logger.js";
import { buildTestConfig, cleanupTestConfig, mockLocalModelResponse } from "./helpers.js";

const ALL_OAUTH_CREDS = {
  GITHUB_OAUTH_CLIENT_ID: "test-github-cid",
  GITHUB_OAUTH_CLIENT_SECRET: "test-github-csec",
  JIRA_OAUTH_CLIENT_ID: "test-jira-cid",
  JIRA_OAUTH_CLIENT_SECRET: "test-jira-csec",
  JIRA_BASE_URL: "https://your-domain.atlassian.net",
  GOOGLE_OAUTH_CLIENT_ID: "test-google-cid",
  GOOGLE_OAUTH_CLIENT_SECRET: "test-google-csec"
};

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

function mockRepeatedLocalModelResponse(
  responseText = "Summary:\nGuest mode is working.\n\nCaveats:\n- None."
) {
  vi.restoreAllMocks();
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    jsonResponse({
      message: {
        content: responseText
      }
    })
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

async function deleteWithCsrf(
  agent: ReturnType<typeof request.agent>,
  path: string
) {
  const csrfToken = await getCsrf(agent);
  return agent.delete(path).set("x-csrf-token", csrfToken);
}

async function connectProviderViaOAuth(
  agent: ReturnType<typeof request.agent>,
  provider: "github" | "jira" | "google",
  email?: string
) {
  const startResponse = await agent.get(`/api/v1/auth/providers/${provider}/start`);
  expect(startResponse.status).toBe(302);

  const state = extractQueryParam(startResponse.headers.location as string, "state");
  expect(state).toBeTruthy();

  const resolvedEmail = email ?? `${provider}-user@example.com`;
  if (provider === "github") {
    mockGitHubOAuthResponses({ email: resolvedEmail });
  } else if (provider === "jira") {
    mockJiraOAuthResponses({ email: resolvedEmail });
  }

  const callbackResponse = await agent.get(
    `/api/v1/auth/providers/${provider}/callback?code=test-code&state=${state}`
  );

  expect(callbackResponse.status).toBe(302);
  return callbackResponse;
}

async function signInViaOAuth(
  agent: ReturnType<typeof request.agent>,
  provider: "github" | "jira" | "google",
  email: string,
  name?: string
) {
  const startResponse = await agent.get(`/api/v1/auth/providers/${provider}/start`);
  expect(startResponse.status).toBe(302);

  const state = extractQueryParam(startResponse.headers.location as string, "state");
  expect(state).toBeTruthy();

  if (provider === "github") {
    mockGitHubOAuthResponses({ email, login: email.split("@")[0], name: name ?? "OAuth User" });
  } else if (provider === "jira") {
    mockJiraOAuthResponses({ email, name: name ?? "OAuth User", nickname: email.split("@")[0] });
  }

  const callbackResponse = await agent.get(
    `/api/v1/auth/providers/${provider}/callback?code=test-code&state=${state}`
  );

  expect(callbackResponse.status).toBe(302);
  return callbackResponse;
}

describe("enterprise api routes", () => {
  beforeEach(() => {});

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function buildAuthenticatedAgent(overrides: Record<string, string | undefined> = {}) {
    const config = buildTestConfig({ ...ALL_OAUTH_CREDS, ...overrides });
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
    expect(sessionResponse.body.providerAuth.providerModes.jira).toBe("unavailable");

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

  it("returns an error when provider OAuth is not configured", async () => {
    const config = buildTestConfig();
    const database = initializeDatabase(config);
    const app = createApp(config, logger.child({ test: "oauth-not-configured" }), database);
    const agent = request.agent(app);

    const sessionResponse = await agent.get("/api/v1/auth/session");
    expect(sessionResponse.body.providerAuth.providerModes.github).toBe("unavailable");

    const response = await agent.get("/api/v1/auth/providers/github/start");

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("provider_auth=error");

    database.close();
    cleanupTestConfig(config);
  });

  it("creates a new account through OAuth sign-in flow", async () => {
    const config = buildTestConfig(ALL_OAUTH_CREDS);
    const database = initializeDatabase(config);
    const app = createApp(config, logger.child({ test: "oauth-login" }), database);
    const agent = request.agent(app);

    await signInViaOAuth(agent, "github", "octo@example.com", "Octo Example");

    const sessionResponse = await agent.get("/api/v1/auth/session");
    expect(sessionResponse.body.authenticated).toBe(true);
    expect(sessionResponse.body.user.email).toBe("octo@example.com");
    expect(sessionResponse.body.providerAuth.github.status).toBe("connected");
    expect(sessionResponse.body.providerAuth.github.authMethod).toBe("oauth");

    const createdUser = database.findUserByEmail("octo@example.com");
    expect(createdUser?.name).toBe("Octo Example");

    database.close();
    cleanupTestConfig(config);
  });

  it("preserves returnTo through GitHub OAuth sign-in", async () => {
    const config = buildTestConfig({
      GITHUB_OAUTH_CLIENT_ID: "github-client-id",
      GITHUB_OAUTH_CLIENT_SECRET: "github-client-secret"
    });
    const database = initializeDatabase(config);
    const app = createApp(config, logger.child({ test: "github-oauth-return-to" }), database);
    const agent = request.agent(app);

    const startResponse = await agent.get("/api/v1/auth/providers/github/start?returnTo=/settings");
    const state = extractQueryParam(startResponse.headers.location, "state");
    expect(startResponse.status).toBe(302);
    expect(state).toBeTruthy();

    mockGitHubOAuthResponses({
      email: "return-to@example.com",
      login: "return-to-user",
      name: "Return To User"
    });

    const callbackResponse = await agent.get(
      `/api/v1/auth/providers/github/callback?code=test-code&state=${state}`
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.location).toContain("/settings?provider_auth=connected&provider=github");

    database.close();
    cleanupTestConfig(config);
  });

  it("signs an existing user in through OAuth without requiring a password", async () => {
    const config = buildTestConfig(ALL_OAUTH_CREDS);
    const database = initializeDatabase(config);
    const app = createApp(config, logger.child({ test: "oauth-existing" }), database);
    const agent = request.agent(app);

    await postWithCsrf(agent, "/api/v1/auth/register", {
      name: "Existing User",
      email: "existing@example.com",
      password: "supersecurepassword",
      organizationName: "Existing Workspace"
    });

    await postWithCsrf(agent, "/api/v1/auth/logout", {});

    await signInViaOAuth(agent, "jira", "existing@example.com");

    const sessionResponse = await agent.get("/api/v1/auth/session");
    expect(sessionResponse.body.authenticated).toBe(true);
    expect(sessionResponse.body.user.email).toBe("existing@example.com");
    expect(sessionResponse.body.providerAuth.jira.status).toBe("connected");
    expect(sessionResponse.body.providerAuth.jira.authMethod).toBe("oauth");

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

    await connectProviderViaOAuth(agent, "github");
    await connectProviderViaOAuth(agent, "jira");

    mockLocalModelResponse();

    const sessionResponse = await agent.get("/api/v1/auth/session");
    expect(sessionResponse.body.providerAuth.github.status).toBe("connected");
    expect(sessionResponse.body.providerAuth.jira.status).toBe("connected");

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

  it("serves the workspace shell to guests", async () => {
    const config = buildTestConfig();
    const database = initializeDatabase(config);
    const app = createApp(config, logger.child({ test: "guest-workspace-shell" }), database);
    const agent = request.agent(app);

    const response = await agent.get("/app").redirects(1);

    expect(response.status).toBe(200);
    expect(response.text).toContain("<div id=\"root\"></div>");

    database.close();
    cleanupTestConfig(config);
  });

  it("redirects login into GitHub OAuth and keeps invite registration in-app", async () => {
    const config = buildTestConfig();
    const database = initializeDatabase(config);
    const app = createApp(config, logger.child({ test: "auth-modal-redirect" }), database);
    const agent = request.agent(app);

    const loginResponse = await agent.get("/login?returnTo=/settings");
    const registerResponse = await agent.get("/register?invite=test-token");

    expect(loginResponse.status).toBe(302);
    expect(loginResponse.headers.location).toBe("/api/v1/auth/providers/github/start?returnTo=%2Fsettings");
    expect(registerResponse.status).toBe(302);
    expect(registerResponse.headers.location).toBe("/app?auth=register&invite=test-token");

    database.close();
    cleanupTestConfig(config);
  });

  it("lets guests use five chat prompts before requiring auth", async () => {
    const config = buildTestConfig();
    const database = initializeDatabase(config);
    const app = createApp(config, logger.child({ test: "guest-chat-limit" }), database);
    const agent = request.agent(app);

    mockRepeatedLocalModelResponse();

    for (let index = 1; index <= 5; index += 1) {
      const response = await postWithCsrf(agent, "/api/v1/chat", {
        message: "What is John working on this week?",
        modelId: "local:qwen2.5:7b",
        history: []
      });

      expect(response.status).toBe(200);
      expect(response.body.answer).toContain("### Summary");
      expect(response.body.guestAccess.promptCount).toBe(index);
      expect(response.body.guestAccess.promptsRemaining).toBe(5 - index);
      expect(response.body.guestAccess.authRequired).toBe(index === 5);
    }

    const blockedResponse = await postWithCsrf(agent, "/api/v1/chat", {
      message: "One more prompt",
      modelId: "local:qwen2.5:7b",
      history: []
    });

    expect(blockedResponse.status).toBe(401);
    expect(blockedResponse.body.code).toBe("GUEST_AUTH_REQUIRED");
    expect(blockedResponse.body.guestAccess.promptCount).toBe(5);
    expect(blockedResponse.body.guestAccess.authRequired).toBe(true);

    database.close();
    cleanupTestConfig(config);
  });

  it("accepts the CSRF bootstrap flow for guest chat in Vercel mode", async () => {
    const config = buildTestConfig({
      VERCEL: "1"
    });
    const database = initializeDatabase(config);
    const app = createApp(config, logger.child({ test: "vercel-guest-chat-csrf" }), database);
    const agent = request.agent(app);

    mockRepeatedLocalModelResponse();

    const sessionResponse = await agent.get("/api/v1/auth/session");
    const csrfToken = sessionResponse.body.csrfToken as string;

    const response = await agent.post("/api/v1/chat").set("x-csrf-token", csrfToken).send({
      message: "What is John working on this week?",
      modelId: "local:qwen2.5:7b",
      history: []
    });

    expect(sessionResponse.status).toBe(200);
    expect(response.status).toBe(200);
    expect(response.body.answer).toContain("### Summary");
    expect(response.body.guestAccess.promptCount).toBe(1);

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

  it("saves, lists, and removes LLM provider API keys", async () => {
    const { config, database, agent } = await buildAuthenticatedAgent();

    const saveResponse = await putWithCsrf(agent, "/api/v1/auth/llm-keys/openai", {
      apiKey: "sk-test-1234567890abcdef"
    });
    expect(saveResponse.status).toBe(200);
    expect(saveResponse.body.key.provider).toBe("openai");
    expect(saveResponse.body.key.maskedKey).toContain("••••");
    expect(saveResponse.body.llmProviderKeys.length).toBe(1);

    const listResponse = await agent.get("/api/v1/auth/llm-keys");
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.items.length).toBe(1);
    expect(listResponse.body.items[0].provider).toBe("openai");

    const sessionResponse = await agent.get("/api/v1/auth/session");
    expect(sessionResponse.body.llmProviderKeys.length).toBe(1);
    expect(sessionResponse.body.llmProviderKeys[0].provider).toBe("openai");

    const updateResponse = await putWithCsrf(agent, "/api/v1/auth/llm-keys/openai", {
      apiKey: "sk-updated-key-9876543210xyz"
    });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.llmProviderKeys.length).toBe(1);

    const deleteResponse = await deleteWithCsrf(agent, "/api/v1/auth/llm-keys/openai");
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.removed).toBe(true);
    expect(deleteResponse.body.llmProviderKeys.length).toBe(0);

    database.close();
    cleanupTestConfig(config);
  });

  it("supports multiple LLM providers per user", async () => {
    const { config, database, agent } = await buildAuthenticatedAgent();

    await putWithCsrf(agent, "/api/v1/auth/llm-keys/openai", { apiKey: "sk-openai-test12345678" });
    await putWithCsrf(agent, "/api/v1/auth/llm-keys/gemini", { apiKey: "AIzaSyD-gemini-test1234" });
    await putWithCsrf(agent, "/api/v1/auth/llm-keys/claude", { apiKey: "sk-ant-claude-test12345" });

    const listResponse = await agent.get("/api/v1/auth/llm-keys");
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.items.length).toBe(3);

    const providers = listResponse.body.items.map((k: { provider: string }) => k.provider).sort();
    expect(providers).toEqual(["claude", "gemini", "openai"]);

    database.close();
    cleanupTestConfig(config);
  });

  it("rejects invalid LLM provider names", async () => {
    const { config, database, agent } = await buildAuthenticatedAgent();

    const response = await putWithCsrf(agent, "/api/v1/auth/llm-keys/invalid-provider", {
      apiKey: "sk-test-1234567890abcdef"
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_LLM_PROVIDER");

    database.close();
    cleanupTestConfig(config);
  });

  it("rejects empty or too-short API keys", async () => {
    const { config, database, agent } = await buildAuthenticatedAgent();

    const emptyResponse = await putWithCsrf(agent, "/api/v1/auth/llm-keys/openai", {
      apiKey: ""
    });
    expect(emptyResponse.status).toBe(400);
    expect(emptyResponse.body.code).toBe("MISSING_API_KEY");

    const shortResponse = await putWithCsrf(agent, "/api/v1/auth/llm-keys/openai", {
      apiKey: "short"
    });
    expect(shortResponse.status).toBe(400);
    expect(shortResponse.body.code).toBe("INVALID_API_KEY");

    database.close();
    cleanupTestConfig(config);
  });

  it("returns 404 when removing a non-existent LLM key", async () => {
    const { config, database, agent } = await buildAuthenticatedAgent();

    const response = await deleteWithCsrf(agent, "/api/v1/auth/llm-keys/openai");
    expect(response.status).toBe(404);
    expect(response.body.code).toBe("LLM_KEY_NOT_FOUND");

    database.close();
    cleanupTestConfig(config);
  });
});
