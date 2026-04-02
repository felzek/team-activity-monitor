import type { TeamMember, TrackedRepo } from "./activity.js";

export type OrganizationRole = "owner" | "admin" | "member" | "support";
export type ConnectionStatus = "connected" | "needs_attention" | "pending" | "disabled";
export type ProviderAuthProvider = "github" | "jira" | "google";
export type ProviderAuthStatus = "connected" | "disconnected";
export type LlmProvider = "gateway" | "openai" | "gemini" | "claude" | "local";
export type ProviderConnectionMode = "oauth" | "unavailable";
export type ProviderAuthMode = "oauth" | "mixed" | "unavailable";
export type ProviderAuthFlowEntry = "login" | "connect";

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface SessionUser extends PublicUser {}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  createdAt: string;
}

export interface CurrentOrganization extends OrganizationSummary {}

export interface QueryRunEntry {
  id: string;
  organizationId: string;
  queryText: string;
  responseText: string;
  createdAt: string;
}

export interface AuditEventEntry {
  id: string;
  eventType: string;
  actorName: string | null;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface OrganizationMemberEntry {
  userId: string;
  name: string;
  email: string;
  role: OrganizationRole;
  joinedAt: string;
}

export interface InvitationEntry {
  id: string;
  email: string;
  role: OrganizationRole;
  inviteUrl: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export interface ConnectorRecord {
  id: string;
  organizationId: string;
  secretRef: string | null;
  enabled: boolean;
  status: ConnectionStatus;
  lastValidatedAt: string | null;
  lastError: string | null;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

export interface UserProviderConnection {
  id: string;
  userId: string;
  provider: ProviderAuthProvider;
  status: ProviderAuthStatus;
  externalAccountId: string | null;
  displayName: string | null;
  login: string | null;
  email: string | null;
  authMethod: "oauth";
  connectedAt: string | null;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface ProviderAuthFlowState {
  provider: ProviderAuthProvider;
  entry: ProviderAuthFlowEntry;
  returnTo: string;
  state: string;
  startedAt: string;
  startedByUserId: string | null;
  codeVerifier?: string;
}

export interface ProviderAuthRequirement {
  mode: ProviderAuthMode;
  providerModes: Record<ProviderAuthProvider, ProviderConnectionMode>;
  requiredProviders: ProviderAuthProvider[];
  missingProviders: ProviderAuthProvider[];
  allConnected: boolean;
  jira: UserProviderConnection | null;
  github: UserProviderConnection | null;
  google: UserProviderConnection | null;
}

export interface LlmProviderKey {
  id: string;
  userId: string;
  provider: LlmProvider;
  displayLabel: string;
  maskedKey: string;
  connectedAt: string;
  updatedAt: string;
}

export interface OrganizationSettings {
  teamMembers: TeamMember[];
  trackedRepos: TrackedRepo[];
}

export interface ConversationEntry {
  id: string;
  organizationId: string;
  userId: string;
  projectId: string | null;
  title: string;
  pinned: boolean;
  archivedAt: string | null;
  messageCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageEntry {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ProjectEntry {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  instructions: string | null;
  icon: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GuestAccess {
  promptCount: number;
  promptLimit: number;
  promptsRemaining: number;
  authRequired: boolean;
}

export interface SessionSnapshot {
  authenticated: boolean;
  user: SessionUser | null;
  currentOrganization: CurrentOrganization | null;
  organizations: OrganizationSummary[];
  csrfToken: string | null;
  authMode: "local";
  providerAuth: ProviderAuthRequirement;
  llmProviderKeys: LlmProviderKey[];
  guestAccess: GuestAccess | null;
}
