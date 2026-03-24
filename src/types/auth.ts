import type { TeamMember, TrackedRepo } from "./activity.js";

export type OrganizationRole = "owner" | "admin" | "member" | "support";
export type ConnectionStatus = "connected" | "needs_attention" | "pending" | "disabled";

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

export interface OrganizationSettings {
  teamMembers: TeamMember[];
  trackedRepos: TrackedRepo[];
}

export interface SessionSnapshot {
  authenticated: boolean;
  user: SessionUser | null;
  currentOrganization: CurrentOrganization | null;
  organizations: OrganizationSummary[];
  csrfToken: string | null;
  authMode: "local";
}
