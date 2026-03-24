import { describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { initializeDatabase } from "../src/db.js";
import { logger } from "../src/lib/logger.js";
import { buildTestConfig, cleanupTestConfig } from "./helpers.js";

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

describe("enterprise api routes", () => {
  async function buildAuthenticatedAgent() {
    const config = buildTestConfig();
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

    database.close();
    cleanupTestConfig(config);
  });

  it("returns a grounded org-scoped response for a known user", async () => {
    const { config, database, agent, organizationId } = await buildAuthenticatedAgent();

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
