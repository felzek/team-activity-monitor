import { loadAppConfig } from "../src/config.js";
import { fetchJson } from "../src/lib/http.js";
import { logger } from "../src/lib/logger.js";

async function smokeJira(baseUrl: string, email: string, token: string) {
  const authHeader = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
  const response = await fetchJson<{ accountId: string; displayName: string }>(
    `${baseUrl}/rest/api/3/myself`,
    {
      method: "GET",
      headers: {
        Authorization: authHeader
      }
    },
    {
      provider: "jira",
      logger
    }
  );

  return {
    accountId: response.accountId,
    displayName: response.displayName
  };
}

async function smokeGitHub(token: string) {
  const response = await fetchJson<{ login: string }>(
    "https://api.github.com/user",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    },
    {
      provider: "github",
      logger
    }
  );

  return {
    login: response.login
  };
}

async function main() {
  const config = loadAppConfig();

  if (config.useRecordedFixtures) {
    console.log("Fixture mode is enabled. Smoke checks are skipped in fallback mode.");
    return;
  }

  const [jira, github] = await Promise.all([
    smokeJira(config.jiraBaseUrl!, config.jiraEmail!, config.jiraApiToken!),
    smokeGitHub(config.githubToken!)
  ]);

  console.log(
    JSON.stringify(
      {
        jira,
        github,
        trackedRepoCount: config.trackedRepos.length,
        teamMemberCount: config.teamMembers.length
      },
      null,
      2
    )
  );
}

void main();
