import type { Logger } from "pino";

import type { AppDatabase } from "../db.js";
import type { TeamMember, TrackedRepo } from "../types/activity.js";

interface GitHubRepoEntry {
  name: string;
  owner: { login: string };
  archived: boolean;
  disabled: boolean;
}

async function fetchUserRepos(accessToken: string): Promise<TrackedRepo[]> {
  const url = new URL("https://api.github.com/user/repos");
  url.searchParams.set("affiliation", "owner");
  url.searchParams.set("sort", "updated");
  url.searchParams.set("per_page", "30");
  url.searchParams.set("visibility", "all");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  if (!response.ok) return [];

  const repos = (await response.json()) as GitHubRepoEntry[];
  return repos
    .filter((r) => !r.archived && !r.disabled)
    .map((r) => ({ owner: r.owner.login, repo: r.name }));
}

function buildAliases(displayName: string, githubLogin: string | null): string[] {
  const seen = new Set<string>();
  const aliases: string[] = [];

  const add = (value: string) => {
    const normalized = value.toLowerCase().trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      aliases.push(normalized);
    }
  };

  add(displayName);
  if (githubLogin) add(githubLogin);

  // Add first name if display name is multi-word
  const parts = displayName.trim().split(/\s+/);
  if (parts.length > 1) add(parts[0]);

  return aliases;
}

/**
 * Called after a successful GitHub OAuth. Fetches the user's repos and upserts
 * their profile as a team member in the org's DB settings.
 */
export async function syncGitHubProfileToOrg(
  userId: string,
  orgId: string,
  accessToken: string,
  githubLogin: string,
  displayName: string | null,
  database: AppDatabase,
  logger: Logger
): Promise<void> {
  try {
    const fetchedRepos = await fetchUserRepos(accessToken);

    const resolvedName = displayName ?? githubLogin;
    const newMember: TeamMember = {
      id: userId,
      displayName: resolvedName,
      aliases: buildAliases(resolvedName, githubLogin),
      jiraQuery: resolvedName,
      githubUsername: githubLogin
    };

    const current = database.getOrganizationSettings(orgId);

    // Preserve any existing Jira account ID for this user
    const existing = current.teamMembers.find((m) => m.id === userId);
    if (existing?.jiraAccountId) {
      newMember.jiraAccountId = existing.jiraAccountId;
    }

    const teamMembers = [
      ...current.teamMembers.filter((m) => m.id !== userId),
      newMember
    ];

    // Replace tracked repos with freshly fetched ones — stale repos cause 404s on the real API.
    // Fall back to existing repos only if the fetch returned nothing.
    const trackedRepos = fetchedRepos.length > 0 ? fetchedRepos : current.trackedRepos;

    database.updateOrganizationSettings(orgId, { teamMembers, trackedRepos });

    logger.info(
      { userId, orgId, githubLogin, repoCount: fetchedRepos.length },
      "GitHub profile synced to org settings"
    );
  } catch (err) {
    // Never fail the OAuth callback due to sync errors
    logger.warn(
      { userId, orgId, err },
      "GitHub profile sync failed — user can still query with defaults"
    );
  }
}

/**
 * Called after a successful Jira OAuth. Updates the user's team member entry
 * with their Jira account ID.
 */
export function syncJiraProfileToOrg(
  userId: string,
  orgId: string,
  jiraAccountId: string,
  displayName: string | null,
  database: AppDatabase,
  logger: Logger
): void {
  try {
    const current = database.getOrganizationSettings(orgId);
    const existing = current.teamMembers.find((m) => m.id === userId);

    let teamMembers: TeamMember[];

    if (existing) {
      teamMembers = current.teamMembers.map((m) =>
        m.id === userId ? { ...m, jiraAccountId } : m
      );
    } else {
      // GitHub hasn't synced yet — create a bare entry; GitHub sync will flesh it out
      const resolvedName = displayName ?? "Unknown";
      teamMembers = [
        ...current.teamMembers,
        {
          id: userId,
          displayName: resolvedName,
          aliases: buildAliases(resolvedName, null),
          jiraQuery: resolvedName,
          jiraAccountId
        }
      ];
    }

    database.updateOrganizationSettings(orgId, {
      teamMembers,
      trackedRepos: current.trackedRepos
    });

    logger.info(
      { userId, orgId, jiraAccountId },
      "Jira profile synced to org settings"
    );
  } catch (err) {
    logger.warn(
      { userId, orgId, err },
      "Jira profile sync failed — user can still query with defaults"
    );
  }
}
