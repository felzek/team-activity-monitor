import "dotenv/config";

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { IANAZone } from "luxon";
import { z } from "zod";

import type { TeamMember, TrackedRepo } from "./types/activity.js";

const booleanString = z
  .string()
  .optional()
  .transform((value) => value === "true");

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  APP_NAME: z.string().default("Team Activity Monitor"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  APP_TIMEZONE: z.string().default("America/New_York"),
  USE_RECORDED_FIXTURES: booleanString.default(false),
  TEAM_MEMBERS_CONFIG: z.string().default("config/team-members.json"),
  TRACKED_REPOS_CONFIG: z.string().default("config/repos.json"),
  FIXTURE_DIR: z.string().default("fixtures/demo"),
  DATABASE_PATH: z.string().default("data/app.db"),
  SESSION_SECRET: z.string().default("change-me-in-production"),
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  AWS_REGION: z.string().default("us-east-1"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  JIRA_BASE_URL: z.string().optional(),
  JIRA_EMAIL: z.string().optional(),
  JIRA_API_TOKEN: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434/api"),
  OLLAMA_MODEL: z.string().default("qwen2.5:7b"),
  OLLAMA_KEEP_ALIVE: z.string().default("10m"),
  COGNITO_USER_POOL_ID: z.string().optional(),
  COGNITO_APP_CLIENT_ID: z.string().optional(),
  COGNITO_DOMAIN: z.string().optional()
});

export const teamMemberSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  aliases: z.array(z.string().min(1)).min(1),
  jiraAccountId: z.string().optional(),
  jiraQuery: z.string().optional(),
  githubUsername: z.string().optional()
});

export const trackedRepoSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  disabled: z.boolean().optional()
});

export interface AppConfig {
  port: number;
  appName: string;
  appBaseUrl: string;
  appTimezone: string;
  appEnv: "development" | "staging" | "production";
  awsRegion: string;
  useRecordedFixtures: boolean;
  teamMembersConfigPath: string;
  trackedReposConfigPath: string;
  fixtureDir: string;
  databasePath: string;
  sessionSecret: string;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
  githubToken?: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaKeepAlive: string;
  cognitoUserPoolId?: string;
  cognitoAppClientId?: string;
  cognitoDomain?: string;
  teamMembers: TeamMember[];
  trackedRepos: TrackedRepo[];
}

function resolveFromCwd(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

function readJsonFile<T>(filePath: string, schema: z.ZodType<T>): T {
  const absolutePath = resolveFromCwd(filePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Required config file not found: ${absolutePath}`);
  }

  const raw = readFileSync(absolutePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return schema.parse(parsed);
}

function validateTimezone(timezone: string): void {
  if (!IANAZone.isValidZone(timezone)) {
    throw new Error(`Invalid APP_TIMEZONE: ${timezone}`);
  }
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsedEnv = envSchema.parse(env);
  validateTimezone(parsedEnv.APP_TIMEZONE);

  const teamMembers = readJsonFile(
    parsedEnv.TEAM_MEMBERS_CONFIG,
    z.array(teamMemberSchema)
  );
  const trackedRepos = readJsonFile(
    parsedEnv.TRACKED_REPOS_CONFIG,
    z.array(trackedRepoSchema)
  ).filter((repo) => !repo.disabled);

  if (trackedRepos.length === 0) {
    throw new Error("TRACKED_REPOS_CONFIG must contain at least one enabled repository.");
  }

  if (!parsedEnv.USE_RECORDED_FIXTURES) {
    const missing = [
      ["JIRA_BASE_URL", parsedEnv.JIRA_BASE_URL],
      ["JIRA_EMAIL", parsedEnv.JIRA_EMAIL],
      ["JIRA_API_TOKEN", parsedEnv.JIRA_API_TOKEN],
      ["GITHUB_TOKEN", parsedEnv.GITHUB_TOKEN]
    ].filter(([, value]) => !value);

    if (missing.length > 0) {
      const names = missing.map(([name]) => name).join(", ");
      throw new Error(
        `Missing required environment variables for live mode: ${names}. Set USE_RECORDED_FIXTURES=true to run in fallback mode.`
      );
    }
  }

  return {
    port: parsedEnv.PORT,
    appName: parsedEnv.APP_NAME,
    appBaseUrl: parsedEnv.APP_BASE_URL,
    appTimezone: parsedEnv.APP_TIMEZONE,
    appEnv: parsedEnv.APP_ENV,
    awsRegion: parsedEnv.AWS_REGION,
    useRecordedFixtures: parsedEnv.USE_RECORDED_FIXTURES,
    teamMembersConfigPath: resolveFromCwd(parsedEnv.TEAM_MEMBERS_CONFIG),
    trackedReposConfigPath: resolveFromCwd(parsedEnv.TRACKED_REPOS_CONFIG),
    fixtureDir: resolveFromCwd(parsedEnv.FIXTURE_DIR),
    databasePath: resolveFromCwd(parsedEnv.DATABASE_PATH),
    sessionSecret: parsedEnv.SESSION_SECRET,
    rateLimitWindowMs: parsedEnv.RATE_LIMIT_WINDOW_MS,
    rateLimitMaxRequests: parsedEnv.RATE_LIMIT_MAX_REQUESTS,
    jiraBaseUrl: parsedEnv.JIRA_BASE_URL,
    jiraEmail: parsedEnv.JIRA_EMAIL,
    jiraApiToken: parsedEnv.JIRA_API_TOKEN,
    githubToken: parsedEnv.GITHUB_TOKEN,
    ollamaBaseUrl: parsedEnv.OLLAMA_BASE_URL,
    ollamaModel: parsedEnv.OLLAMA_MODEL,
    ollamaKeepAlive: parsedEnv.OLLAMA_KEEP_ALIVE,
    cognitoUserPoolId: parsedEnv.COGNITO_USER_POOL_ID,
    cognitoAppClientId: parsedEnv.COGNITO_APP_CLIENT_ID,
    cognitoDomain: parsedEnv.COGNITO_DOMAIN,
    teamMembers,
    trackedRepos
  };
}
