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

const optionalBooleanString = z
  .string()
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "true"));

const scopeString = z
  .string()
  .transform((value) =>
    value
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
  );

const csvString = z
  .string()
  .optional()
  .transform((value) =>
    value
      ? value
          .split(/[\n,]/)
          .map((entry) => entry.trim())
          .filter(Boolean)
      : []
  );

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  APP_NAME: z.string().default("Team Activity Monitor"),
  APP_BASE_URL: z.string().url().optional(),
  APP_TIMEZONE: z.string().default("America/New_York"),
  TEAM_MEMBERS_CONFIG: z.string().default("config/team-members.json"),
  TRACKED_REPOS_CONFIG: z.string().default("config/repos.json"),
  DATABASE_PATH: z.string().optional(),
  SESSION_SECRET: z.string().default("change-me-in-production"),
  APP_ENV: z.enum(["development", "staging", "production"]).optional(),
  AWS_REGION: z.string().default("us-east-1"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  BACKGROUND_WORKER_ENABLED: optionalBooleanString,
  JIRA_BASE_URL: z.string().optional(),
  JIRA_EMAIL: z.string().optional(),
  JIRA_API_TOKEN: z.string().optional(),
  JIRA_OAUTH_CLIENT_ID: z.string().optional(),
  JIRA_OAUTH_CLIENT_SECRET: z.string().optional(),
  JIRA_OAUTH_SCOPE: scopeString.default([
    "read:me",
    "read:jira-user",
    "read:jira-work",
    "offline_access"
  ]),
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
  GITHUB_OAUTH_SCOPE: scopeString.default(["repo", "read:user", "user:email"]),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_SCOPE: scopeString.default([
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/presentations"
  ]),
  GOOGLE_PICKER_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434/api"),
  OLLAMA_MODEL: z.string().default("qwen2.5:7b"),
  OLLAMA_KEEP_ALIVE: z.string().default("10m"),
  DEFAULT_MODEL_ID: z.string().optional(),
  AI_GATEWAY_BASE_URL: z.string().url().default("https://ai-gateway.vercel.sh/v1"),
  AI_GATEWAY_API_KEY: z.string().optional(),
  VERCEL_OIDC_TOKEN: z.string().optional(),
  AI_GATEWAY_DEFAULT_MODEL: z.string().default("alibaba/qwen3.5-flash"),
  AI_GATEWAY_MODELS: csvString,
  COGNITO_USER_POOL_ID: z.string().optional(),
  COGNITO_APP_CLIENT_ID: z.string().optional(),
  COGNITO_DOMAIN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Team Activity <noreply@yourdomain.com>")
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
  isVercel: boolean;
  vercelEnv?: "development" | "preview" | "production";
  secureCookies: boolean;
  awsRegion: string;
  teamMembersConfigPath: string;
  trackedReposConfigPath: string;
  databasePath: string;
  databasePersistence: "durable" | "ephemeral";
  sessionSecret: string;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  backgroundWorkerEnabled: boolean;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
  jiraOAuthClientId?: string;
  jiraOAuthClientSecret?: string;
  jiraOAuthScope: string[];
  githubToken?: string;
  githubOAuthClientId?: string;
  githubOAuthClientSecret?: string;
  githubOAuthScope: string[];
  googleOAuthClientId?: string;
  googleOAuthClientSecret?: string;
  googleOAuthScope: string[];
  googlePickerApiKey?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaKeepAlive: string;
  defaultModelId: string;
  aiGatewayBaseUrl: string;
  aiGatewayApiKey?: string;
  vercelOidcToken?: string;
  aiGatewayDefaultModel: string;
  aiGatewayModels: string[];
  cognitoUserPoolId?: string;
  cognitoAppClientId?: string;
  cognitoDomain?: string;
  resendApiKey?: string;
  emailFrom: string;
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

function validatePairedOAuthConfig(
  provider: string,
  clientId?: string,
  clientSecret?: string
): void {
  if (Boolean(clientId) === Boolean(clientSecret)) {
    return;
  }

  throw new Error(
    `${provider} OAuth must include both client ID and client secret, or neither.`
  );
}

function detectVercel(env: NodeJS.ProcessEnv): boolean {
  return env.VERCEL === "1" || Boolean(env.VERCEL_ENV || env.VERCEL_URL);
}

function inferAppBaseUrl(
  explicitBaseUrl: string | undefined,
  env: NodeJS.ProcessEnv
): string {
  if (explicitBaseUrl) {
    return explicitBaseUrl;
  }

  const vercelHost = env.VERCEL_PROJECT_PRODUCTION_URL ?? env.VERCEL_URL;
  if (vercelHost) {
    return `https://${vercelHost}`;
  }

  return "http://localhost:3000";
}

function inferAppEnv(
  explicitEnv: AppConfig["appEnv"] | undefined,
  env: NodeJS.ProcessEnv
): AppConfig["appEnv"] {
  if (explicitEnv) {
    return explicitEnv;
  }

  if (env.VERCEL_ENV === "production") {
    return "production";
  }

  if (env.VERCEL_ENV === "preview") {
    return "staging";
  }

  if (env.NODE_ENV === "production") {
    return "production";
  }

  return "development";
}

function inferDatabasePath(
  explicitPath: string | undefined,
  isVercel: boolean
): string {
  if (explicitPath && explicitPath.trim()) {
    return explicitPath;
  }

  return isVercel ? "/tmp/team-activity-monitor.db" : "data/app.db";
}

function normalizeGatewayModels(models: string[], defaultModel: string): string[] {
  const seen = new Set<string>();

  return [defaultModel, ...models]
    .map((entry) => entry.trim())
    .filter((entry) => entry.includes("/"))
    .filter((entry) => {
      if (seen.has(entry)) {
        return false;
      }

      seen.add(entry);
      return true;
    });
}

function inferDefaultModelId(
  explicitDefault: string | undefined,
  gatewayConfigured: boolean,
  gatewayDefaultModel: string,
  ollamaModel: string
): string {
  if (explicitDefault?.trim()) {
    return explicitDefault.trim();
  }

  return gatewayConfigured
    ? `gateway:${gatewayDefaultModel}`
    : `local:${ollamaModel}`;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsedEnv = envSchema.parse(env);
  const isVercel = detectVercel(env);
  const appBaseUrl = z.string().url().parse(inferAppBaseUrl(parsedEnv.APP_BASE_URL, env));
  const appEnv = inferAppEnv(parsedEnv.APP_ENV, env);
  const databasePath = inferDatabasePath(parsedEnv.DATABASE_PATH, isVercel);
  const databasePersistence = databasePath.startsWith("/tmp/")
    ? "ephemeral"
    : "durable";
  const gatewayConfigured = Boolean(
    parsedEnv.AI_GATEWAY_API_KEY || parsedEnv.VERCEL_OIDC_TOKEN
  );
  const aiGatewayModels = normalizeGatewayModels(
    parsedEnv.AI_GATEWAY_MODELS,
    parsedEnv.AI_GATEWAY_DEFAULT_MODEL
  );
  const defaultModelId = inferDefaultModelId(
    parsedEnv.DEFAULT_MODEL_ID,
    gatewayConfigured,
    parsedEnv.AI_GATEWAY_DEFAULT_MODEL,
    parsedEnv.OLLAMA_MODEL
  );

  validateTimezone(parsedEnv.APP_TIMEZONE);
  validatePairedOAuthConfig(
    "GitHub",
    parsedEnv.GITHUB_OAUTH_CLIENT_ID,
    parsedEnv.GITHUB_OAUTH_CLIENT_SECRET
  );
  validatePairedOAuthConfig(
    "Jira",
    parsedEnv.JIRA_OAUTH_CLIENT_ID,
    parsedEnv.JIRA_OAUTH_CLIENT_SECRET
  );
  validatePairedOAuthConfig(
    "Google",
    parsedEnv.GOOGLE_OAUTH_CLIENT_ID,
    parsedEnv.GOOGLE_OAUTH_CLIENT_SECRET
  );

  if ((appEnv === "production" || isVercel) && parsedEnv.SESSION_SECRET === "change-me-in-production") {
    throw new Error("SESSION_SECRET must be set to a strong value for Vercel and production deployments.");
  }

  if (defaultModelId.startsWith("gateway:") && !gatewayConfigured) {
    throw new Error(
      "DEFAULT_MODEL_ID points at Vercel AI Gateway, but neither AI_GATEWAY_API_KEY nor VERCEL_OIDC_TOKEN is configured."
    );
  }

  const teamMembers = readJsonFile(
    parsedEnv.TEAM_MEMBERS_CONFIG,
    z.array(teamMemberSchema)
  );
  const trackedRepos = readJsonFile(
    parsedEnv.TRACKED_REPOS_CONFIG,
    z.array(trackedRepoSchema)
  ).filter((repo) => !repo.disabled);

  // Repos may be empty when using OAuth-based per-org repo discovery — not a startup error.

  return {
    port: parsedEnv.PORT,
    appName: parsedEnv.APP_NAME,
    appBaseUrl,
    appTimezone: parsedEnv.APP_TIMEZONE,
    appEnv,
    isVercel,
    vercelEnv:
      env.VERCEL_ENV === "development" ||
      env.VERCEL_ENV === "preview" ||
      env.VERCEL_ENV === "production"
        ? env.VERCEL_ENV
        : undefined,
    secureCookies: appBaseUrl.startsWith("https://"),
    awsRegion: parsedEnv.AWS_REGION,
    teamMembersConfigPath: resolveFromCwd(parsedEnv.TEAM_MEMBERS_CONFIG),
    trackedReposConfigPath: resolveFromCwd(parsedEnv.TRACKED_REPOS_CONFIG),
    databasePath: resolveFromCwd(databasePath),
    databasePersistence,
    sessionSecret: parsedEnv.SESSION_SECRET,
    rateLimitWindowMs: parsedEnv.RATE_LIMIT_WINDOW_MS,
    rateLimitMaxRequests: parsedEnv.RATE_LIMIT_MAX_REQUESTS,
    backgroundWorkerEnabled:
      parsedEnv.BACKGROUND_WORKER_ENABLED ?? !isVercel,
    jiraBaseUrl: parsedEnv.JIRA_BASE_URL,
    jiraEmail: parsedEnv.JIRA_EMAIL,
    jiraApiToken: parsedEnv.JIRA_API_TOKEN,
    jiraOAuthClientId: parsedEnv.JIRA_OAUTH_CLIENT_ID,
    jiraOAuthClientSecret: parsedEnv.JIRA_OAUTH_CLIENT_SECRET,
    jiraOAuthScope: parsedEnv.JIRA_OAUTH_SCOPE,
    githubToken: parsedEnv.GITHUB_TOKEN,
    githubOAuthClientId: parsedEnv.GITHUB_OAUTH_CLIENT_ID,
    githubOAuthClientSecret: parsedEnv.GITHUB_OAUTH_CLIENT_SECRET,
    githubOAuthScope: parsedEnv.GITHUB_OAUTH_SCOPE,
    googleOAuthClientId: parsedEnv.GOOGLE_OAUTH_CLIENT_ID,
    googleOAuthClientSecret: parsedEnv.GOOGLE_OAUTH_CLIENT_SECRET,
    googleOAuthScope: parsedEnv.GOOGLE_OAUTH_SCOPE,
    googlePickerApiKey: parsedEnv.GOOGLE_PICKER_API_KEY,
    openaiApiKey: parsedEnv.OPENAI_API_KEY,
    anthropicApiKey: parsedEnv.ANTHROPIC_API_KEY,
    geminiApiKey: parsedEnv.GEMINI_API_KEY,
    ollamaBaseUrl: parsedEnv.OLLAMA_BASE_URL,
    ollamaModel: parsedEnv.OLLAMA_MODEL,
    ollamaKeepAlive: parsedEnv.OLLAMA_KEEP_ALIVE,
    defaultModelId,
    aiGatewayBaseUrl: parsedEnv.AI_GATEWAY_BASE_URL,
    aiGatewayApiKey: parsedEnv.AI_GATEWAY_API_KEY,
    vercelOidcToken: parsedEnv.VERCEL_OIDC_TOKEN,
    aiGatewayDefaultModel: parsedEnv.AI_GATEWAY_DEFAULT_MODEL,
    aiGatewayModels,
    cognitoUserPoolId: parsedEnv.COGNITO_USER_POOL_ID,
    cognitoAppClientId: parsedEnv.COGNITO_APP_CLIENT_ID,
    cognitoDomain: parsedEnv.COGNITO_DOMAIN,
    resendApiKey: parsedEnv.RESEND_API_KEY,
    emailFrom: parsedEnv.EMAIL_FROM,
    teamMembers,
    trackedRepos
  };
}
