import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { AppConfig } from "../config.js";
import type {
  ProviderAuthFlowEntry,
  ProviderAuthFlowState,
  ProviderAuthMode,
  ProviderAuthProvider,
  ProviderAuthRequirement,
  ProviderConnectionMode
} from "../types/auth.js";
import { AppError } from "./errors.js";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";
const ATLASSIAN_AUTHORIZE_URL = "https://auth.atlassian.com/authorize";
const ATLASSIAN_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
const ATLASSIAN_ME_URL = "https://api.atlassian.com/me";
const ATLASSIAN_RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources";
const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

interface GitHubUserProfile {
  id: number;
  login: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  html_url?: string | null;
}

interface GitHubEmailRecord {
  email: string;
  primary?: boolean;
  verified?: boolean;
  visibility?: string | null;
}

interface AtlassianMeProfile {
  account_id: string;
  email?: string | null;
  name?: string | null;
  nickname?: string | null;
  picture?: string | null;
  zoneinfo?: string | null;
  locale?: string | null;
}

interface AtlassianAccessibleResource {
  id: string;
  name?: string | null;
  url?: string | null;
  scopes?: string[];
  avatarUrl?: string | null;
}

interface GoogleUserProfile {
  id: string;
  email?: string | null;
  verified_email?: boolean;
  name?: string | null;
  given_name?: string | null;
  family_name?: string | null;
  picture?: string | null;
  locale?: string | null;
}

interface OAuthTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

export interface ResolvedProviderIdentity {
  provider: ProviderAuthProvider;
  externalAccountId: string;
  displayName: string | null;
  login: string | null;
  email: string | null;
  metadata: Record<string, unknown>;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: string | null;
}

function normalizedUrl(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/\/$/, "").toLowerCase();
}

function encodeBase64Url(value: Buffer): string {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sha256Base64Url(value: string): string {
  return encodeBase64Url(createHash("sha256").update(value).digest());
}

function oauthCallbackUrl(config: AppConfig, provider: ProviderAuthProvider): string {
  return `${config.appBaseUrl.replace(/\/$/, "")}/api/v1/auth/providers/${provider}/callback`;
}

function requireOAuthConfig(config: AppConfig, provider: ProviderAuthProvider): void {
  if (getProviderConnectionMode(config, provider) === "oauth") {
    return;
  }

  throw new AppError(`${providerLabel(provider)} OAuth is not configured in this environment.`, {
    code: "PROVIDER_AUTH_MODE_UNAVAILABLE",
    statusCode: 501
  });
}

function providerLabel(provider: ProviderAuthProvider): string {
  if (provider === "jira") return "Jira";
  if (provider === "google") return "Google";
  return "GitHub";
}

function buildGitHubAuthorizeUrl(config: AppConfig, flow: ProviderAuthFlowState): string {
  if (!config.githubOAuthClientId) {
    throw new AppError("GitHub OAuth client ID is missing.", {
      code: "GITHUB_OAUTH_CONFIG_INVALID",
      statusCode: 500
    });
  }

  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.githubOAuthClientId);
  url.searchParams.set("redirect_uri", oauthCallbackUrl(config, "github"));
  url.searchParams.set("scope", config.githubOAuthScope.join(" "));
  url.searchParams.set("state", flow.state);

  if (flow.codeVerifier) {
    url.searchParams.set("code_challenge", sha256Base64Url(flow.codeVerifier));
    url.searchParams.set("code_challenge_method", "S256");
  }

  return url.toString();
}

function buildJiraAuthorizeUrl(config: AppConfig, flow: ProviderAuthFlowState): string {
  if (!config.jiraOAuthClientId) {
    throw new AppError("Jira OAuth client ID is missing.", {
      code: "JIRA_OAUTH_CONFIG_INVALID",
      statusCode: 500
    });
  }

  const url = new URL(ATLASSIAN_AUTHORIZE_URL);
  url.searchParams.set("audience", "api.atlassian.com");
  url.searchParams.set("client_id", config.jiraOAuthClientId);
  url.searchParams.set("scope", config.jiraOAuthScope.join(" "));
  url.searchParams.set("redirect_uri", oauthCallbackUrl(config, "jira"));
  url.searchParams.set("state", flow.state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  const rawBody = await response.text();

  if (!rawBody) {
    if (!response.ok) {
      throw new AppError(fallbackMessage, {
        code: "PROVIDER_OAUTH_RESPONSE_INVALID",
        statusCode: 502
      });
    }

    return {} as T;
  }

  if (contentType.includes("application/json")) {
    return JSON.parse(rawBody) as T;
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(rawBody).entries()) as T;
  }

  return JSON.parse(rawBody) as T;
}

async function exchangeGitHubCode(
  config: AppConfig,
  code: string,
  flow: ProviderAuthFlowState
): Promise<OAuthTokenResponse> {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: config.githubOAuthClientId!,
      client_secret: config.githubOAuthClientSecret!,
      code,
      redirect_uri: oauthCallbackUrl(config, "github"),
      ...(flow.codeVerifier ? { code_verifier: flow.codeVerifier } : {})
    }).toString()
  });
  const payload = await readJsonResponse<OAuthTokenResponse>(
    response,
    "GitHub did not return an OAuth token."
  );

  if (!response.ok || !payload.access_token) {
    throw new AppError(
      payload.error_description || payload.error || "GitHub sign-in could not be completed.",
      {
        code: "GITHUB_OAUTH_EXCHANGE_FAILED",
        statusCode: 502
      }
    );
  }

  return payload;
}

async function exchangeJiraCode(config: AppConfig, code: string): Promise<OAuthTokenResponse> {
  const response = await fetch(ATLASSIAN_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: config.jiraOAuthClientId,
      client_secret: config.jiraOAuthClientSecret,
      code,
      redirect_uri: oauthCallbackUrl(config, "jira")
    })
  });
  const payload = await readJsonResponse<OAuthTokenResponse>(
    response,
    "Jira did not return an OAuth token."
  );

  if (!response.ok || !payload.access_token) {
    throw new AppError(
      payload.error_description || payload.error || "Jira sign-in could not be completed.",
      {
        code: "JIRA_OAUTH_EXCHANGE_FAILED",
        statusCode: 502
      }
    );
  }

  return payload;
}

function pickGitHubEmail(
  profile: GitHubUserProfile,
  emails: GitHubEmailRecord[]
): string | null {
  if (profile.email) {
    return profile.email;
  }

  const preferred =
    emails.find((entry) => entry.primary && entry.verified) ??
    emails.find((entry) => entry.primary) ??
    emails.find((entry) => entry.verified) ??
    emails[0];

  return preferred?.email ?? null;
}

async function fetchGitHubIdentity(
  accessToken: string,
  tokenResponse: OAuthTokenResponse
): Promise<ResolvedProviderIdentity> {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": "team-activity-monitor"
  };

  const [profileResponse, emailsResponse] = await Promise.all([
    fetch(GITHUB_USER_URL, { headers }),
    fetch(GITHUB_EMAILS_URL, { headers })
  ]);
  const profile = await readJsonResponse<GitHubUserProfile>(
    profileResponse,
    "GitHub user profile could not be read."
  );
  const emails = emailsResponse.ok
    ? await readJsonResponse<GitHubEmailRecord[]>(
        emailsResponse,
        "GitHub email addresses could not be read."
      )
    : [];

  if (!profileResponse.ok || !profile.id || !profile.login) {
    throw new AppError("GitHub did not return a usable user profile.", {
      code: "GITHUB_PROFILE_INVALID",
      statusCode: 502
    });
  }

  return {
    provider: "github",
    externalAccountId: String(profile.id),
    displayName: profile.name ?? profile.login ?? null,
    login: profile.login ?? null,
    email: pickGitHubEmail(profile, emails),
    metadata: {
      mode: "oauth",
      scope: tokenResponse.scope ?? null,
      tokenType: tokenResponse.token_type ?? null,
      avatarUrl: profile.avatar_url ?? null,
      profileUrl: profile.html_url ?? null
    },
    accessToken,
    refreshToken: null,
    tokenExpiresAt: null
  };
}

function pickJiraResource(
  config: AppConfig,
  resources: AtlassianAccessibleResource[]
): AtlassianAccessibleResource | null {
  const configuredBaseUrl = normalizedUrl(config.jiraBaseUrl);

  if (configuredBaseUrl) {
    return (
      resources.find((entry) => normalizedUrl(entry.url) === configuredBaseUrl) ?? null
    );
  }

  return resources[0] ?? null;
}

async function fetchJiraIdentity(
  config: AppConfig,
  accessToken: string,
  tokenResponse: OAuthTokenResponse
): Promise<ResolvedProviderIdentity> {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`
  };

  const [profileResponse, resourcesResponse] = await Promise.all([
    fetch(ATLASSIAN_ME_URL, { headers }),
    fetch(ATLASSIAN_RESOURCES_URL, { headers })
  ]);
  const profile = await readJsonResponse<AtlassianMeProfile>(
    profileResponse,
    "Jira user profile could not be read."
  );
  const resources = resourcesResponse.ok
    ? await readJsonResponse<AtlassianAccessibleResource[]>(
        resourcesResponse,
        "Jira accessible resources could not be read."
      )
    : [];

  if (!profileResponse.ok || !profile.account_id) {
    throw new AppError("Jira did not return a usable user profile.", {
      code: "JIRA_PROFILE_INVALID",
      statusCode: 502
    });
  }

  const site = pickJiraResource(config, resources);
  if (config.jiraBaseUrl && !site) {
    throw new AppError(
      "The signed-in Jira account does not have access to the configured Jira site.",
      {
        code: "JIRA_SITE_ACCESS_MISSING",
        statusCode: 403
      }
    );
  }

  const expiresIn = tokenResponse.expires_in;
  const tokenExpiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  return {
    provider: "jira",
    externalAccountId: profile.account_id,
    displayName: profile.name ?? profile.nickname ?? null,
    login: profile.nickname ?? null,
    email: profile.email ?? null,
    metadata: {
      mode: "oauth",
      scope: tokenResponse.scope ?? null,
      expiresIn: expiresIn ?? null,
      siteId: site?.id ?? null,
      siteName: site?.name ?? null,
      siteUrl: site?.url ?? null,
      avatarUrl: profile.picture ?? null,
      zoneinfo: profile.zoneinfo ?? null,
      locale: profile.locale ?? null
    },
    accessToken,
    refreshToken: tokenResponse.refresh_token ?? null,
    tokenExpiresAt
  };
}

function buildGoogleAuthorizeUrl(config: AppConfig, flow: ProviderAuthFlowState): string {
  if (!config.googleOAuthClientId) {
    throw new AppError("Google OAuth client ID is missing.", {
      code: "GOOGLE_OAUTH_CONFIG_INVALID",
      statusCode: 500
    });
  }

  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.googleOAuthClientId);
  url.searchParams.set("redirect_uri", oauthCallbackUrl(config, "google"));
  url.searchParams.set("scope", config.googleOAuthScope.join(" "));
  url.searchParams.set("state", flow.state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  if (flow.codeVerifier) {
    url.searchParams.set("code_challenge", sha256Base64Url(flow.codeVerifier));
    url.searchParams.set("code_challenge_method", "S256");
  }

  return url.toString();
}

async function exchangeGoogleCode(
  config: AppConfig,
  code: string,
  flow: ProviderAuthFlowState
): Promise<OAuthTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: config.googleOAuthClientId!,
      client_secret: config.googleOAuthClientSecret!,
      code,
      redirect_uri: oauthCallbackUrl(config, "google"),
      grant_type: "authorization_code",
      ...(flow.codeVerifier ? { code_verifier: flow.codeVerifier } : {})
    }).toString()
  });
  const payload = await readJsonResponse<OAuthTokenResponse>(
    response,
    "Google did not return an OAuth token."
  );

  if (!response.ok || !payload.access_token) {
    throw new AppError(
      payload.error_description || payload.error || "Google sign-in could not be completed.",
      {
        code: "GOOGLE_OAUTH_EXCHANGE_FAILED",
        statusCode: 502
      }
    );
  }

  return payload;
}

async function fetchGoogleIdentity(
  accessToken: string,
  tokenResponse: OAuthTokenResponse
): Promise<ResolvedProviderIdentity> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`
    }
  });
  const profile = await readJsonResponse<GoogleUserProfile>(
    response,
    "Google user profile could not be read."
  );

  if (!response.ok || !profile.id) {
    throw new AppError("Google did not return a usable user profile.", {
      code: "GOOGLE_PROFILE_INVALID",
      statusCode: 502
    });
  }

  return {
    provider: "google",
    externalAccountId: profile.id,
    displayName: profile.name ?? null,
    login: profile.email ?? null,
    email: profile.email ?? null,
    metadata: {
      mode: "oauth",
      scope: tokenResponse.scope ?? null,
      tokenType: tokenResponse.token_type ?? null,
      avatarUrl: profile.picture ?? null,
      verifiedEmail: profile.verified_email ?? null,
      locale: profile.locale ?? null
    },
    accessToken,
    refreshToken: tokenResponse.refresh_token ?? null,
    tokenExpiresAt: tokenResponse.expires_in
      ? new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
      : null
  };
}

export function getProviderConnectionMode(
  config: AppConfig,
  provider: ProviderAuthProvider
): ProviderConnectionMode {
  const configured =
    (provider === "github" &&
      Boolean(config.githubOAuthClientId && config.githubOAuthClientSecret)) ||
    (provider === "jira" &&
      Boolean(config.jiraOAuthClientId && config.jiraOAuthClientSecret)) ||
    (provider === "google" &&
      Boolean(config.googleOAuthClientId && config.googleOAuthClientSecret));

  return configured ? "oauth" : "unavailable";
}

export function getProviderModes(
  config: AppConfig
): Record<ProviderAuthProvider, ProviderConnectionMode> {
  return {
    github: getProviderConnectionMode(config, "github"),
    jira: getProviderConnectionMode(config, "jira"),
    google: getProviderConnectionMode(config, "google")
  };
}

export function getProviderAuthMode(config: AppConfig): ProviderAuthMode {
  const consideredModes = [
    getProviderConnectionMode(config, "github"),
    getProviderConnectionMode(config, "jira"),
    getProviderConnectionMode(config, "google")
  ];
  const uniqueModes = new Set(consideredModes);

  if (uniqueModes.size === 1) {
    const [singleMode] = Array.from(uniqueModes);
    return singleMode === "oauth" ? "oauth" : "unavailable";
  }

  return "mixed";
}

export function applyProviderAuthRuntime(
  config: AppConfig,
  providerAuth: ProviderAuthRequirement
): ProviderAuthRequirement {
  return {
    ...providerAuth,
    mode: getProviderAuthMode(config),
    providerModes: getProviderModes(config)
  };
}

export function buildProviderAuthFlowState(
  provider: ProviderAuthProvider,
  entry: ProviderAuthFlowEntry,
  startedByUserId: string | null,
  returnTo: string
): ProviderAuthFlowState {
  return {
    provider,
    entry,
    returnTo,
    state: randomUUID(),
    startedAt: new Date().toISOString(),
    startedByUserId,
    ...(provider === "github" || provider === "google"
      ? { codeVerifier: encodeBase64Url(randomBytes(32)) }
      : {})
  };
}

export function buildProviderAuthorizationUrl(
  config: AppConfig,
  flow: ProviderAuthFlowState
): string {
  requireOAuthConfig(config, flow.provider);

  if (flow.provider === "github") {
    return buildGitHubAuthorizeUrl(config, flow);
  }

  if (flow.provider === "jira") {
    return buildJiraAuthorizeUrl(config, flow);
  }

  if (flow.provider === "google") {
    return buildGoogleAuthorizeUrl(config, flow);
  }

  throw new AppError(`${providerLabel(flow.provider)} OAuth is not supported.`, {
    code: "PROVIDER_AUTH_MODE_UNAVAILABLE",
    statusCode: 501
  });
}

export async function refreshJiraToken(
  config: AppConfig,
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string | null; tokenExpiresAt: string | null }> {
  if (!config.jiraOAuthClientId || !config.jiraOAuthClientSecret) {
    throw new AppError("Jira OAuth is not configured.", {
      code: "JIRA_OAUTH_CONFIG_INVALID",
      statusCode: 500
    });
  }

  const response = await fetch(ATLASSIAN_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: config.jiraOAuthClientId,
      client_secret: config.jiraOAuthClientSecret,
      refresh_token: refreshToken
    })
  });

  const payload = await readJsonResponse<OAuthTokenResponse>(
    response,
    "Jira token refresh failed."
  );

  if (!response.ok || !payload.access_token) {
    throw new AppError(
      payload.error_description ||
        payload.error ||
        "Jira token could not be refreshed. Please reconnect your Jira account.",
      { code: "JIRA_TOKEN_REFRESH_FAILED", statusCode: 502 }
    );
  }

  const expiresIn = payload.expires_in;
  return {
    accessToken: payload.access_token,
    // Atlassian may rotate the refresh token — keep the new one if provided
    refreshToken: payload.refresh_token ?? refreshToken,
    tokenExpiresAt: expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null
  };
}

export async function completeProviderAuthorization(
  config: AppConfig,
  provider: ProviderAuthProvider,
  code: string,
  flow: ProviderAuthFlowState
): Promise<ResolvedProviderIdentity> {
  requireOAuthConfig(config, provider);

  if (provider === "github") {
    const tokenResponse = await exchangeGitHubCode(config, code, flow);
    return fetchGitHubIdentity(tokenResponse.access_token!, tokenResponse);
  }

  if (provider === "jira") {
    const tokenResponse = await exchangeJiraCode(config, code);
    return fetchJiraIdentity(config, tokenResponse.access_token!, tokenResponse);
  }

  if (provider === "google") {
    const tokenResponse = await exchangeGoogleCode(config, code, flow);
    return fetchGoogleIdentity(tokenResponse.access_token!, tokenResponse);
  }

  throw new AppError(`${providerLabel(provider)} OAuth is not supported.`, {
    code: "PROVIDER_AUTH_MODE_UNAVAILABLE",
    statusCode: 501
  });
}
