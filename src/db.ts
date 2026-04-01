import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import type { SessionData, Store } from "express-session";
import session from "express-session";

import type { AppConfig } from "./config.js";
import type { ArtifactKind, ArtifactRecord, ArtifactSpec, ArtifactStatus } from "./lib/artifacts/types.js";
import type { ActivitySummary, TeamMember, TrackedRepo } from "./types/activity.js";
import { decrypt, encrypt, maskApiKey } from "./lib/encryption.js";
import type {
  AuditEventEntry,
  ConnectionStatus,
  ConnectorRecord,
  ConversationEntry,
  InvitationEntry,
  LlmProvider,
  LlmProviderKey,
  MessageEntry,
  OrganizationMemberEntry,
  OrganizationRole,
  OrganizationSettings,
  OrganizationSummary,
  ProjectEntry,
  ProviderAuthProvider,
  ProviderAuthRequirement,
  ProviderAuthStatus,
  PublicUser,
  UserProviderConnection,
  QueryRunEntry
} from "./types/auth.js";

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  created_at: string;
}

interface MembershipRow {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  role: OrganizationRole;
  created_at: string;
}

interface OrganizationSettingsRow {
  team_members_json: string;
  tracked_repos_json: string;
}

interface QueryRunRow {
  id: string;
  organization_id: string;
  query_text: string;
  response_text: string;
  created_at: string;
}

interface AuditEventRow {
  id: string;
  event_type: string;
  target_type: string;
  target_id: string | null;
  metadata_json: string;
  created_at: string;
  actor_name: string | null;
}

interface ConnectorRow {
  id: string;
  organization_id: string;
  secret_ref: string | null;
  enabled: number;
  status: ConnectionStatus;
  last_validated_at: string | null;
  last_error: string | null;
  metadata_json: string;
  updated_at: string;
}

interface InvitationRow {
  id: string;
  organization_id: string;
  email: string;
  role: OrganizationRole;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

interface BackgroundJobRow {
  id: string;
  job_type: string;
  status: string;
  payload_json: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface ArtifactRow {
  id: string;
  organization_id: string;
  user_id: string;
  conversation_id: string | null;
  message_id: string | null;
  kind: string;
  status: string;
  title: string;
  drive_file_id: string | null;
  web_view_link: string | null;
  mime_type: string | null;
  drive_folder_id: string | null;
  source_artifact_id: string | null;
  spec_json: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface UserProviderConnectionRow {
  id: string;
  user_id: string;
  provider: ProviderAuthProvider;
  status: ProviderAuthStatus;
  external_account_id: string | null;
  display_name: string | null;
  login: string | null;
  email: string | null;
  auth_method: "oauth";
  connected_at: string | null;
  metadata_json: string;
  updated_at: string;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  token_expires_at: string | null;
}

interface LlmProviderKeyRow {
  id: string;
  user_id: string;
  provider: LlmProvider;
  display_label: string;
  encrypted_key: string;
  connected_at: string;
  updated_at: string;
}

interface ConversationRow {
  id: string;
  organization_id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  pinned: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  message_count?: number;
  last_message_preview?: string | null;
  last_message_at?: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata_json: string | null;
  created_at: string;
}

interface ProjectRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  icon: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DatabaseDefaults {
  teamMembers: TeamMember[];
  trackedRepos: TrackedRepo[];
  defaultConnectionStatus: ConnectionStatus;
  encryptionSecret: string;
}

function ensureDatabaseDirectory(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function slugifyOrganizationName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "workspace";
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at
  };
}

function toOrganizationSummary(row: MembershipRow): OrganizationSummary {
  return {
    id: row.organization_id,
    name: row.organization_name,
    slug: row.organization_slug,
    role: row.role,
    createdAt: row.created_at
  };
}

function toQueryRunEntry(row: QueryRunRow): QueryRunEntry {
  return {
    id: row.id,
    organizationId: row.organization_id,
    queryText: row.query_text,
    responseText: row.response_text,
    createdAt: row.created_at
  };
}

function toConnectorRecord(row: ConnectorRow): ConnectorRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    secretRef: row.secret_ref,
    enabled: Boolean(row.enabled),
    status: row.status,
    lastValidatedAt: row.last_validated_at,
    lastError: row.last_error,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    updatedAt: row.updated_at
  };
}

function toUserProviderConnection(row: UserProviderConnectionRow): UserProviderConnection {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    status: row.status,
    externalAccountId: row.external_account_id,
    displayName: row.display_name,
    login: row.login,
    email: row.email,
    authMethod: row.auth_method,
    connectedAt: row.connected_at,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    updatedAt: row.updated_at
  };
}

function toLlmProviderKey(row: LlmProviderKeyRow): LlmProviderKey {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    displayLabel: row.display_label,
    maskedKey: row.display_label,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at
  };
}

function toInvitationEntry(row: InvitationRow, baseUrl: string): InvitationEntry {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    inviteUrl: `${baseUrl.replace(/\/$/, "")}/register?invite=${row.token}`,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at
  };
}

function toAuditEventEntry(row: AuditEventRow): AuditEventEntry {
  return {
    id: row.id,
    eventType: row.event_type,
    actorName: row.actor_name,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: row.created_at
  };
}

class SqliteSessionStore extends session.Store implements Store {
  private readonly database: Database.Database;

  constructor(database: Database.Database) {
    super();
    this.database = database;
  }

  private getExpiration(sessionData: SessionData): number {
    const cookieExpires = sessionData.cookie?.expires;
    if (cookieExpires) {
      return new Date(cookieExpires).getTime();
    }

    return Date.now() + 1000 * 60 * 60 * 24 * 7;
  }

  get(sid: string, callback: (err?: unknown, session?: SessionData | null) => void): void {
    try {
      const row = this.database
        .prepare(
          `SELECT sess
           FROM sessions
           WHERE sid = ?
             AND expires_at > ?`
        )
        .get(sid, Date.now()) as { sess: string } | undefined;

      if (!row) {
        callback(undefined, null);
        return;
      }

      callback(undefined, JSON.parse(row.sess) as SessionData);
    } catch (error) {
      callback(error);
    }
  }

  set(
    sid: string,
    sessionData: SessionData,
    callback?: (err?: unknown) => void
  ): void {
    try {
      this.database
        .prepare(
          `INSERT INTO sessions (sid, sess, expires_at)
           VALUES (?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET
             sess = excluded.sess,
             expires_at = excluded.expires_at`
        )
        .run(sid, JSON.stringify(sessionData), this.getExpiration(sessionData));

      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    try {
      this.database.prepare(`DELETE FROM sessions WHERE sid = ?`).run(sid);
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  touch(
    sid: string,
    sessionData: SessionData,
    callback?: (err?: unknown) => void
  ): void {
    try {
      this.database
        .prepare(`UPDATE sessions SET expires_at = ? WHERE sid = ?`)
        .run(this.getExpiration(sessionData), sid);
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }
}

export class AppDatabase {
  readonly connection: Database.Database;
  readonly sessionStore: SqliteSessionStore;

  private readonly defaults: DatabaseDefaults;

  constructor(connection: Database.Database, defaults: DatabaseDefaults) {
    this.connection = connection;
    this.defaults = defaults;
    this.sessionStore = new SqliteSessionStore(connection);
  }

  ping(): void {
    this.connection.prepare("SELECT 1").get();
  }

  cleanupExpiredSessions(): void {
    this.connection
      .prepare(`DELETE FROM sessions WHERE expires_at <= ?`)
      .run(Date.now());
  }

  private buildUniqueSlug(name: string): string {
    const base = slugifyOrganizationName(name);
    let candidate = base;
    let index = 1;

    while (
      this.connection
        .prepare(`SELECT 1 FROM organizations WHERE slug = ?`)
        .get(candidate)
    ) {
      index += 1;
      candidate = `${base}-${index}`;
    }

    return candidate;
  }

  private seedOrganizationResources(organizationId: string): void {
    const now = new Date().toISOString();

    this.connection
      .prepare(
        `INSERT INTO organization_settings (
          organization_id,
          team_members_json,
          tracked_repos_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(organization_id) DO NOTHING`
      )
      .run(
        organizationId,
        JSON.stringify(this.defaults.teamMembers),
        JSON.stringify(this.defaults.trackedRepos),
        now,
        now
      );

    this.connection
      .prepare(
        `INSERT INTO jira_connections (
          id,
          organization_id,
          secret_ref,
          enabled,
          status,
          metadata_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id) DO NOTHING`
      )
      .run(
        randomUUID(),
        organizationId,
        null,
        1,
        this.defaults.defaultConnectionStatus,
        JSON.stringify({ provider: "jira" }),
        now,
        now
      );

    this.connection
      .prepare(
        `INSERT INTO github_connections (
          id,
          organization_id,
          secret_ref,
          enabled,
          status,
          metadata_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id) DO NOTHING`
      )
      .run(
        randomUUID(),
        organizationId,
        null,
        1,
        this.defaults.defaultConnectionStatus,
        JSON.stringify({ provider: "github" }),
        now,
        now
      );
  }

  private createOrganizationInternal(name: string): OrganizationSummary {
    const organizationId = randomUUID();
    const createdAt = new Date().toISOString();
    const slug = this.buildUniqueSlug(name);

    this.connection
      .prepare(
        `INSERT INTO organizations (id, name, slug, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(organizationId, name.trim(), slug, createdAt, createdAt);

    this.seedOrganizationResources(organizationId);

    return {
      id: organizationId,
      name: name.trim(),
      slug,
      role: "owner",
      createdAt
    };
  }

  private addMembership(userId: string, organizationId: string, role: OrganizationRole): void {
    this.connection
      .prepare(
        `INSERT OR IGNORE INTO organization_memberships (
          id,
          organization_id,
          user_id,
          role,
          created_at
        )
        VALUES (?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), organizationId, userId, role, new Date().toISOString());
  }

  backfillLegacyUsers(): void {
    const rows = this.connection
      .prepare(
        `SELECT u.id, u.name
         FROM users u
         LEFT JOIN organization_memberships om ON om.user_id = u.id
         WHERE om.id IS NULL`
      )
      .all() as Array<{ id: string; name: string }>;

    const transaction = this.connection.transaction((legacyUsers: Array<{ id: string; name: string }>) => {
      for (const legacyUser of legacyUsers) {
        const organization = this.createOrganizationInternal(`${legacyUser.name}'s workspace`);
        this.addMembership(legacyUser.id, organization.id, "owner");
      }
    });

    transaction(rows);
  }

  findUserByEmail(email: string): (PublicUser & { passwordHash: string }) | null {
    const row = this.connection
      .prepare(
        `SELECT id, name, email, password_hash, created_at
         FROM users
         WHERE email = ?`
      )
      .get(email.toLowerCase()) as UserRow | undefined;

    if (!row) {
      return null;
    }

    return {
      ...toPublicUser(row),
      passwordHash: row.password_hash
    };
  }

  findUserById(id: string): PublicUser | null {
    const row = this.connection
      .prepare(
        `SELECT id, name, email, password_hash, created_at
         FROM users
         WHERE id = ?`
      )
      .get(id) as UserRow | undefined;

    return row ? toPublicUser(row) : null;
  }

  createUser(input: {
    name: string;
    email: string;
    passwordHash: string;
  }): PublicUser {
    const userId = randomUUID();
    const createdAt = new Date().toISOString();

    this.connection
      .prepare(
        `INSERT INTO users (id, name, email, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        input.name.trim(),
        input.email.toLowerCase(),
        input.passwordHash,
        createdAt,
        createdAt
      );

    return {
      id: userId,
      name: input.name.trim(),
      email: input.email.toLowerCase(),
      createdAt
    };
  }

  createUserWithOrganization(input: {
    name: string;
    email: string;
    passwordHash: string;
    organizationName?: string;
  }): { user: PublicUser; organization: OrganizationSummary } {
    const transaction = this.connection.transaction((payload: typeof input) => {
      const user = this.createUser({
        name: payload.name,
        email: payload.email,
        passwordHash: payload.passwordHash
      });
      const organization = this.createOrganizationInternal(
        payload.organizationName?.trim() || `${payload.name.trim()}'s workspace`
      );
      this.addMembership(user.id, organization.id, "owner");

      return { user, organization };
    });

    return transaction(input);
  }

  createUserFromInvitation(input: {
    name: string;
    email: string;
    passwordHash: string;
    inviteToken: string;
  }): { user: PublicUser; organization: OrganizationSummary } {
    const transaction = this.connection.transaction((payload: typeof input) => {
      const invitation = this.connection
        .prepare(
          `SELECT id, organization_id, email, role, token, expires_at, accepted_at, created_at
           FROM organization_invitations
           WHERE token = ?`
        )
        .get(payload.inviteToken) as InvitationRow | undefined;

      if (!invitation) {
        throw new Error("Invitation not found.");
      }

      if (invitation.accepted_at) {
        throw new Error("Invitation has already been accepted.");
      }

      if (new Date(invitation.expires_at).getTime() < Date.now()) {
        throw new Error("Invitation has expired.");
      }

      const user = this.createUser({
        name: payload.name,
        email: payload.email,
        passwordHash: payload.passwordHash
      });

      this.addMembership(user.id, invitation.organization_id, invitation.role);
      this.connection
        .prepare(
          `UPDATE organization_invitations
           SET accepted_at = ?
           WHERE id = ?`
        )
        .run(new Date().toISOString(), invitation.id);

      const organization = this.getOrganizationForUser(user.id, invitation.organization_id);
      if (!organization) {
        throw new Error("Invitation organization is not accessible.");
      }

      return { user, organization };
    });

    return transaction(input);
  }

  listUserOrganizations(userId: string): OrganizationSummary[] {
    const rows = this.connection
      .prepare(
        `SELECT o.id AS organization_id,
                o.name AS organization_name,
                o.slug AS organization_slug,
                om.role AS role,
                o.created_at AS created_at
         FROM organization_memberships om
         INNER JOIN organizations o ON o.id = om.organization_id
         WHERE om.user_id = ?
         ORDER BY o.created_at ASC`
      )
      .all(userId) as MembershipRow[];

    return rows.map(toOrganizationSummary);
  }

  getOrganizationForUser(userId: string, organizationId: string): OrganizationSummary | null {
    const row = this.connection
      .prepare(
        `SELECT o.id AS organization_id,
                o.name AS organization_name,
                o.slug AS organization_slug,
                om.role AS role,
                o.created_at AS created_at
         FROM organization_memberships om
         INNER JOIN organizations o ON o.id = om.organization_id
         WHERE om.user_id = ?
           AND om.organization_id = ?`
      )
      .get(userId, organizationId) as MembershipRow | undefined;

    return row ? toOrganizationSummary(row) : null;
  }

  getOrganizationSettings(organizationId: string): OrganizationSettings {
    const row = this.connection
      .prepare(
        `SELECT team_members_json, tracked_repos_json
         FROM organization_settings
         WHERE organization_id = ?`
      )
      .get(organizationId) as OrganizationSettingsRow | undefined;

    if (!row) {
      return {
        teamMembers: this.defaults.teamMembers,
        trackedRepos: this.defaults.trackedRepos
      };
    }

    return {
      teamMembers: parseJson<TeamMember[]>(row.team_members_json, this.defaults.teamMembers),
      trackedRepos: parseJson<TrackedRepo[]>(row.tracked_repos_json, this.defaults.trackedRepos)
    };
  }

  updateOrganizationSettings(
    organizationId: string,
    settings: OrganizationSettings
  ): OrganizationSettings {
    const now = new Date().toISOString();
    this.connection
      .prepare(
        `INSERT INTO organization_settings (
          organization_id,
          team_members_json,
          tracked_repos_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(organization_id) DO UPDATE SET
          team_members_json = excluded.team_members_json,
          tracked_repos_json = excluded.tracked_repos_json,
          updated_at = excluded.updated_at`
      )
      .run(
        organizationId,
        JSON.stringify(settings.teamMembers),
        JSON.stringify(settings.trackedRepos),
        now,
        now
      );

    return this.getOrganizationSettings(organizationId);
  }

  private getConnector(tableName: "jira_connections" | "github_connections", organizationId: string) {
    const row = this.connection
      .prepare(
        `SELECT id,
                organization_id,
                secret_ref,
                enabled,
                status,
                last_validated_at,
                last_error,
                metadata_json,
                updated_at
         FROM ${tableName}
         WHERE organization_id = ?`
      )
      .get(organizationId) as ConnectorRow | undefined;

    return row ? toConnectorRecord(row) : null;
  }

  private upsertConnector(
    tableName: "jira_connections" | "github_connections",
    organizationId: string,
    input: {
      secretRef?: string | null;
      enabled?: boolean;
      status?: ConnectionStatus;
      lastValidatedAt?: string | null;
      lastError?: string | null;
      metadata?: Record<string, unknown>;
    }
  ): ConnectorRecord {
    const existing = this.getConnector(tableName, organizationId);
    const now = new Date().toISOString();

    if (!existing) {
      this.seedOrganizationResources(organizationId);
    }

    const next = {
      id: existing?.id ?? randomUUID(),
      secretRef: input.secretRef ?? existing?.secretRef ?? null,
      enabled: input.enabled ?? existing?.enabled ?? true,
      status: input.status ?? existing?.status ?? this.defaults.defaultConnectionStatus,
      lastValidatedAt:
        input.lastValidatedAt === undefined
          ? existing?.lastValidatedAt ?? null
          : input.lastValidatedAt,
      lastError: input.lastError === undefined ? existing?.lastError ?? null : input.lastError,
      metadata: input.metadata ?? existing?.metadata ?? {}
    };

    this.connection
      .prepare(
        `INSERT INTO ${tableName} (
          id,
          organization_id,
          secret_ref,
          enabled,
          status,
          last_validated_at,
          last_error,
          metadata_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id) DO UPDATE SET
          secret_ref = excluded.secret_ref,
          enabled = excluded.enabled,
          status = excluded.status,
          last_validated_at = excluded.last_validated_at,
          last_error = excluded.last_error,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at`
      )
      .run(
        next.id,
        organizationId,
        next.secretRef,
        next.enabled ? 1 : 0,
        next.status,
        next.lastValidatedAt,
        next.lastError,
        JSON.stringify(next.metadata),
        now,
        now
      );

    return this.getConnector(tableName, organizationId)!;
  }

  getJiraConnection(organizationId: string): ConnectorRecord {
    return this.getConnector("jira_connections", organizationId)!;
  }

  updateJiraConnection(
    organizationId: string,
    input: {
      secretRef?: string | null;
      enabled?: boolean;
      status?: ConnectionStatus;
      lastValidatedAt?: string | null;
      lastError?: string | null;
      metadata?: Record<string, unknown>;
    }
  ): ConnectorRecord {
    return this.upsertConnector("jira_connections", organizationId, input);
  }

  getGitHubConnection(organizationId: string): ConnectorRecord {
    return this.getConnector("github_connections", organizationId)!;
  }

  updateGitHubConnection(
    organizationId: string,
    input: {
      secretRef?: string | null;
      enabled?: boolean;
      status?: ConnectionStatus;
      lastValidatedAt?: string | null;
      lastError?: string | null;
      metadata?: Record<string, unknown>;
    }
  ): ConnectorRecord {
    return this.upsertConnector("github_connections", organizationId, input);
  }

  getUserProviderConnection(
    userId: string,
    provider: ProviderAuthProvider
  ): UserProviderConnection | null {
    const row = this.connection
      .prepare(
        `SELECT id,
                user_id,
                provider,
                status,
                external_account_id,
                display_name,
                login,
                email,
                auth_method,
                connected_at,
                metadata_json,
                updated_at
         FROM user_provider_connections
         WHERE user_id = ?
           AND provider = ?`
      )
      .get(userId, provider) as UserProviderConnectionRow | undefined;

    return row ? toUserProviderConnection(row) : null;
  }

  findUserProviderConnectionByExternalAccount(
    provider: ProviderAuthProvider,
    externalAccountId: string
  ): UserProviderConnection | null {
    const row = this.connection
      .prepare(
        `SELECT id,
                user_id,
                provider,
                status,
                external_account_id,
                display_name,
                login,
                email,
                auth_method,
                connected_at,
                metadata_json,
                updated_at
         FROM user_provider_connections
         WHERE provider = ?
           AND external_account_id = ?`
      )
      .get(provider, externalAccountId) as UserProviderConnectionRow | undefined;

    return row ? toUserProviderConnection(row) : null;
  }

  upsertUserProviderConnection(
    userId: string,
    provider: ProviderAuthProvider,
    input: {
      status: ProviderAuthStatus;
      externalAccountId?: string | null;
      displayName?: string | null;
      login?: string | null;
      email?: string | null;
      authMethod?: "oauth";
      connectedAt?: string | null;
      metadata?: Record<string, unknown>;
      accessToken?: string | null;
      refreshToken?: string | null;
      tokenExpiresAt?: string | null;
    }
  ): UserProviderConnection {
    const existing = this.getUserProviderConnection(userId, provider);
    const now = new Date().toISOString();
    const next = {
      id: existing?.id ?? randomUUID(),
      status: input.status,
      externalAccountId:
        input.externalAccountId === undefined
          ? existing?.externalAccountId ?? null
          : input.externalAccountId,
      displayName:
        input.displayName === undefined ? existing?.displayName ?? null : input.displayName,
      login: input.login === undefined ? existing?.login ?? null : input.login,
      email: input.email === undefined ? existing?.email ?? null : input.email,
      authMethod: input.authMethod ?? existing?.authMethod ?? "oauth",
      connectedAt:
        input.connectedAt === undefined
          ? input.status === "connected"
            ? existing?.connectedAt ?? now
            : null
          : input.connectedAt,
      metadata: input.metadata ?? existing?.metadata ?? {}
    };

    const encryptedAccessToken =
      input.accessToken != null
        ? encrypt(input.accessToken, this.defaults.encryptionSecret)
        : null;
    const encryptedRefreshToken =
      input.refreshToken != null
        ? encrypt(input.refreshToken, this.defaults.encryptionSecret)
        : null;

    this.connection
      .prepare(
        `INSERT INTO user_provider_connections (
          id,
          user_id,
          provider,
          status,
          external_account_id,
          display_name,
          login,
          email,
          auth_method,
          connected_at,
          metadata_json,
          encrypted_access_token,
          encrypted_refresh_token,
          token_expires_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, provider) DO UPDATE SET
          status = excluded.status,
          external_account_id = excluded.external_account_id,
          display_name = excluded.display_name,
          login = excluded.login,
          email = excluded.email,
          auth_method = excluded.auth_method,
          connected_at = excluded.connected_at,
          metadata_json = excluded.metadata_json,
          encrypted_access_token = COALESCE(excluded.encrypted_access_token, encrypted_access_token),
          encrypted_refresh_token = COALESCE(excluded.encrypted_refresh_token, encrypted_refresh_token),
          token_expires_at = COALESCE(excluded.token_expires_at, token_expires_at),
          updated_at = excluded.updated_at`
      )
      .run(
        next.id,
        userId,
        provider,
        next.status,
        next.externalAccountId,
        next.displayName,
        next.login,
        next.email,
        next.authMethod,
        next.connectedAt,
        JSON.stringify(next.metadata),
        encryptedAccessToken,
        encryptedRefreshToken,
        input.tokenExpiresAt ?? null,
        now,
        now
      );

    return this.getUserProviderConnection(userId, provider)!;
  }

  disconnectUserProviderConnection(
    userId: string,
    provider: ProviderAuthProvider
  ): UserProviderConnection {
    return this.upsertUserProviderConnection(userId, provider, {
      status: "disconnected",
      externalAccountId: null,
      displayName: null,
      login: null,
      email: null,
      connectedAt: null,
      metadata: {},
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null
    });
  }

  updateProviderTokens(
    userId: string,
    provider: ProviderAuthProvider,
    tokens: { accessToken: string; refreshToken: string | null; tokenExpiresAt: string | null }
  ): void {
    const encryptedAccessToken = encrypt(tokens.accessToken, this.defaults.encryptionSecret);
    const encryptedRefreshToken = tokens.refreshToken
      ? encrypt(tokens.refreshToken, this.defaults.encryptionSecret)
      : null;
    const now = new Date().toISOString();

    this.connection
      .prepare(
        `UPDATE user_provider_connections
         SET encrypted_access_token = ?,
             encrypted_refresh_token = COALESCE(?, encrypted_refresh_token),
             token_expires_at = ?,
             updated_at = ?
         WHERE user_id = ? AND provider = ?`
      )
      .run(
        encryptedAccessToken,
        encryptedRefreshToken,
        tokens.tokenExpiresAt,
        now,
        userId,
        provider
      );
  }

  getUserProviderToken(
    userId: string,
    provider: ProviderAuthProvider
  ): { accessToken: string; refreshToken: string | null; expiresAt: string | null } | null {
    const row = this.connection
      .prepare(
        `SELECT encrypted_access_token, encrypted_refresh_token, token_expires_at
         FROM user_provider_connections
         WHERE user_id = ? AND provider = ? AND status = 'connected'`
      )
      .get(userId, provider) as
      | { encrypted_access_token: string | null; encrypted_refresh_token: string | null; token_expires_at: string | null }
      | undefined;

    if (!row?.encrypted_access_token) return null;

    return {
      accessToken: decrypt(row.encrypted_access_token, this.defaults.encryptionSecret),
      refreshToken: row.encrypted_refresh_token
        ? decrypt(row.encrypted_refresh_token, this.defaults.encryptionSecret)
        : null,
      expiresAt: row.token_expires_at ?? null
    };
  }

  listLlmProviderKeys(userId: string): LlmProviderKey[] {
    const rows = this.connection
      .prepare(
        `SELECT id, user_id, provider, display_label, encrypted_key, connected_at, updated_at
         FROM llm_provider_keys
         WHERE user_id = ?
         ORDER BY connected_at ASC`
      )
      .all(userId) as LlmProviderKeyRow[];

    return rows.map(toLlmProviderKey);
  }

  getLlmProviderKey(userId: string, provider: LlmProvider): LlmProviderKey | null {
    const row = this.connection
      .prepare(
        `SELECT id, user_id, provider, display_label, encrypted_key, connected_at, updated_at
         FROM llm_provider_keys
         WHERE user_id = ? AND provider = ?`
      )
      .get(userId, provider) as LlmProviderKeyRow | undefined;

    return row ? toLlmProviderKey(row) : null;
  }

  upsertLlmProviderKey(
    userId: string,
    provider: LlmProvider,
    apiKey: string
  ): LlmProviderKey {
    const now = new Date().toISOString();
    const encryptedKey = encrypt(apiKey, this.defaults.encryptionSecret);
    const masked = maskApiKey(apiKey);
    const existing = this.getLlmProviderKey(userId, provider);
    const id = existing?.id ?? randomUUID();

    this.connection
      .prepare(
        `INSERT INTO llm_provider_keys (id, user_id, provider, display_label, encrypted_key, connected_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, provider) DO UPDATE SET
           display_label = excluded.display_label,
           encrypted_key = excluded.encrypted_key,
           updated_at = excluded.updated_at`
      )
      .run(id, userId, provider, masked, encryptedKey, existing?.connectedAt ?? now, now);

    return this.getLlmProviderKey(userId, provider)!;
  }

  decryptLlmProviderKey(userId: string, provider: LlmProvider): string | null {
    const row = this.connection
      .prepare(
        `SELECT encrypted_key FROM llm_provider_keys WHERE user_id = ? AND provider = ?`
      )
      .get(userId, provider) as { encrypted_key: string } | undefined;

    if (!row) return null;
    return decrypt(row.encrypted_key, this.defaults.encryptionSecret);
  }

  deleteLlmProviderKey(userId: string, provider: LlmProvider): boolean {
    const result = this.connection
      .prepare(`DELETE FROM llm_provider_keys WHERE user_id = ? AND provider = ?`)
      .run(userId, provider);

    return result.changes > 0;
  }

  getProviderAuthRequirement(
    userId: string,
    requiredProviders: ProviderAuthProvider[] = ["github", "jira"]
  ): ProviderAuthRequirement {
    const jira = this.getUserProviderConnection(userId, "jira");
    const github = this.getUserProviderConnection(userId, "github");
    const google = this.getUserProviderConnection(userId, "google");
    const connections: Record<ProviderAuthProvider, UserProviderConnection | null> = {
      jira,
      github,
      google
    };
    const missingProviders = requiredProviders.filter((provider) => {
      return connections[provider]?.status !== "connected";
    });

    return {
      mode: "unavailable",
      providerModes: {
        github: "unavailable",
        jira: "unavailable",
        google: "unavailable"
      },
      requiredProviders,
      missingProviders,
      allConnected: missingProviders.length === 0,
      jira,
      github,
      google
    };
  }

  createInvitation(input: {
    organizationId: string;
    email: string;
    role: OrganizationRole;
    createdByUserId: string;
    baseUrl: string;
  }): InvitationEntry {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
    const token = randomUUID();

    this.connection
      .prepare(
        `INSERT INTO organization_invitations (
          id,
          organization_id,
          email,
          role,
          token,
          expires_at,
          accepted_at,
          created_at,
          created_by_user_id
        )
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .run(
        id,
        input.organizationId,
        input.email.toLowerCase(),
        input.role,
        token,
        expiresAt,
        createdAt,
        input.createdByUserId
      );

    return toInvitationEntry(
      {
        id,
        organization_id: input.organizationId,
        email: input.email.toLowerCase(),
        role: input.role,
        token,
        expires_at: expiresAt,
        accepted_at: null,
        created_at: createdAt
      },
      input.baseUrl
    );
  }

  findInvitationByToken(token: string, baseUrl: string): InvitationEntry | null {
    const row = this.connection
      .prepare(
        `SELECT id,
                organization_id,
                email,
                role,
                token,
                expires_at,
                accepted_at,
                created_at
         FROM organization_invitations
         WHERE token = ?`
      )
      .get(token) as InvitationRow | undefined;

    return row ? toInvitationEntry(row, baseUrl) : null;
  }

  listInvitations(organizationId: string, baseUrl: string, limit = 12): InvitationEntry[] {
    const rows = this.connection
      .prepare(
        `SELECT id,
                organization_id,
                email,
                role,
                token,
                expires_at,
                accepted_at,
                created_at
         FROM organization_invitations
         WHERE organization_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(organizationId, limit) as InvitationRow[];

    return rows.map((row) => toInvitationEntry(row, baseUrl));
  }

  listOrganizationMembers(organizationId: string): OrganizationMemberEntry[] {
    const rows = this.connection
      .prepare(
        `SELECT u.id AS user_id,
                u.name AS name,
                u.email AS email,
                om.role AS role,
                om.created_at AS joined_at
         FROM organization_memberships om
         INNER JOIN users u ON u.id = om.user_id
         WHERE om.organization_id = ?
         ORDER BY om.created_at ASC`
      )
      .all(organizationId) as Array<{
        user_id: string;
        name: string;
        email: string;
        role: OrganizationRole;
        joined_at: string;
      }>;

    return rows.map((row) => ({
      userId: row.user_id,
      name: row.name,
      email: row.email,
      role: row.role,
      joinedAt: row.joined_at
    }));
  }

  saveQueryRun(input: {
    organizationId: string;
    userId: string;
    queryText: string;
    responseText: string;
    summary: ActivitySummary;
  }): QueryRunEntry {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    this.connection
      .prepare(
        `INSERT INTO query_runs (id, organization_id, user_id, query_text, response_text, summary_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.organizationId,
        input.userId,
        input.queryText,
        input.responseText,
        JSON.stringify(input.summary),
        createdAt
      );

    return {
      id,
      organizationId: input.organizationId,
      queryText: input.queryText,
      responseText: input.responseText,
      createdAt
    };
  }

  listRecentQueryRuns(organizationId: string, limit = 12): QueryRunEntry[] {
    const rows = this.connection
      .prepare(
        `SELECT id, organization_id, query_text, response_text, created_at
         FROM query_runs
         WHERE organization_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(organizationId, limit) as QueryRunRow[];

    return rows.map(toQueryRunEntry);
  }

  recordAuditEvent(input: {
    organizationId: string;
    actorUserId?: string | null;
    eventType: string;
    targetType: string;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  }): AuditEventEntry {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    this.connection
      .prepare(
        `INSERT INTO audit_events (
          id,
          organization_id,
          actor_user_id,
          event_type,
          target_type,
          target_id,
          metadata_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.organizationId,
        input.actorUserId ?? null,
        input.eventType,
        input.targetType,
        input.targetId ?? null,
        JSON.stringify(input.metadata ?? {}),
        createdAt
      );

    const event = this.connection
      .prepare(
        `SELECT ae.id,
                ae.event_type,
                ae.target_type,
                ae.target_id,
                ae.metadata_json,
                ae.created_at,
                u.name AS actor_name
         FROM audit_events ae
         LEFT JOIN users u ON u.id = ae.actor_user_id
         WHERE ae.id = ?`
      )
      .get(id) as AuditEventRow;

    return toAuditEventEntry(event);
  }

  listAuditEvents(organizationId: string, limit = 20): AuditEventEntry[] {
    const rows = this.connection
      .prepare(
        `SELECT ae.id,
                ae.event_type,
                ae.target_type,
                ae.target_id,
                ae.metadata_json,
                ae.created_at,
                u.name AS actor_name
         FROM audit_events ae
         LEFT JOIN users u ON u.id = ae.actor_user_id
         WHERE ae.organization_id = ?
         ORDER BY ae.created_at DESC
         LIMIT ?`
      )
      .all(organizationId, limit) as AuditEventRow[];

    return rows.map(toAuditEventEntry);
  }

  createBackgroundJob(input: {
    organizationId: string;
    jobType: string;
    payload: Record<string, unknown>;
    status?: string;
    errorMessage?: string | null;
  }) {
    const now = new Date().toISOString();
    const id = randomUUID();

    this.connection
      .prepare(
        `INSERT INTO background_jobs (
          id,
          organization_id,
          job_type,
          status,
          payload_json,
          error_message,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.organizationId,
        input.jobType,
        input.status ?? "queued",
        JSON.stringify(input.payload),
        input.errorMessage ?? null,
        now,
        now
      );

    return {
      id,
      jobType: input.jobType,
      status: input.status ?? "queued",
      payload: input.payload,
      createdAt: now
    };
  }

  listBackgroundJobs(organizationId: string, limit = 10) {
    const rows = this.connection
      .prepare(
        `SELECT id, job_type, status, payload_json, error_message, created_at, updated_at
         FROM background_jobs
         WHERE organization_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(organizationId, limit) as BackgroundJobRow[];

    return rows.map((row) => ({
      id: row.id,
      jobType: row.job_type,
      status: row.status,
      payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  claimPendingJob(): {
    id: string;
    organizationId: string;
    jobType: string;
    payload: Record<string, unknown>;
  } | null {
    const now = new Date().toISOString();
    const row = this.connection
      .prepare(
        `UPDATE background_jobs
         SET status = 'processing', updated_at = ?
         WHERE id = (
           SELECT id FROM background_jobs
           WHERE status = 'queued'
           ORDER BY created_at ASC
           LIMIT 1
         )
         RETURNING id, organization_id, job_type, payload_json`
      )
      .get(now) as
      | { id: string; organization_id: string; job_type: string; payload_json: string }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      organizationId: row.organization_id,
      jobType: row.job_type,
      payload: parseJson<Record<string, unknown>>(row.payload_json, {})
    };
  }

  updateBackgroundJob(
    id: string,
    update: { status: string; errorMessage?: string | null }
  ) {
    const now = new Date().toISOString();
    this.connection
      .prepare(
        `UPDATE background_jobs
         SET status = ?, error_message = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(update.status, update.errorMessage ?? null, now, id);
  }

  // ── Conversations ──────────────────────────────────────────────────────

  createConversation(input: {
    organizationId: string;
    userId: string;
    title?: string;
    projectId?: string;
  }): ConversationEntry {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.connection
      .prepare(
        `INSERT INTO conversations (id, organization_id, user_id, project_id, title, pinned, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(id, input.organizationId, input.userId, input.projectId ?? null, input.title ?? "New chat", now, now);
    return {
      id,
      organizationId: input.organizationId,
      userId: input.userId,
      projectId: input.projectId ?? null,
      title: input.title ?? "New chat",
      pinned: false,
      archivedAt: null,
      messageCount: 0,
      lastMessagePreview: null,
      lastMessageAt: null,
      createdAt: now,
      updatedAt: now
    };
  }

  getConversation(conversationId: string, userId: string): ConversationEntry | null {
    const row = this.connection
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) AS message_count,
                (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_preview,
                (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
         FROM conversations c
         WHERE c.id = ? AND c.user_id = ?`
      )
      .get(conversationId, userId) as ConversationRow | undefined;
    return row ? this.mapConversationRow(row) : null;
  }

  listConversations(input: {
    userId: string;
    organizationId: string;
    archived?: boolean;
    projectId?: string | null;
    pinnedOnly?: boolean;
    limit?: number;
    offset?: number;
  }): { conversations: ConversationEntry[]; total: number } {
    const conditions: string[] = ["c.user_id = ?", "c.organization_id = ?"];
    const params: unknown[] = [input.userId, input.organizationId];

    if (input.archived) {
      conditions.push("c.archived_at IS NOT NULL");
    } else {
      conditions.push("c.archived_at IS NULL");
    }

    if (input.projectId !== undefined) {
      if (input.projectId === null) {
        conditions.push("c.project_id IS NULL");
      } else {
        conditions.push("c.project_id = ?");
        params.push(input.projectId);
      }
    }

    if (input.pinnedOnly) {
      conditions.push("c.pinned = 1");
    }

    const where = conditions.join(" AND ");
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;

    const total = (
      this.connection
        .prepare(`SELECT COUNT(*) AS cnt FROM conversations c WHERE ${where}`)
        .get(...params) as { cnt: number }
    ).cnt;

    const rows = this.connection
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) AS message_count,
                (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_preview,
                (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
         FROM conversations c
         WHERE ${where}
         ORDER BY c.pinned DESC, c.updated_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as ConversationRow[];

    return {
      conversations: rows.map((r) => this.mapConversationRow(r)),
      total
    };
  }

  updateConversation(
    conversationId: string,
    userId: string,
    patch: { title?: string; pinned?: boolean; archived?: boolean; projectId?: string | null }
  ): boolean {
    const sets: string[] = [];
    const params: unknown[] = [];
    const now = new Date().toISOString();

    if (patch.title !== undefined) {
      sets.push("title = ?");
      params.push(patch.title);
    }
    if (patch.pinned !== undefined) {
      sets.push("pinned = ?");
      params.push(patch.pinned ? 1 : 0);
    }
    if (patch.archived !== undefined) {
      sets.push("archived_at = ?");
      params.push(patch.archived ? now : null);
    }
    if (patch.projectId !== undefined) {
      sets.push("project_id = ?");
      params.push(patch.projectId);
    }

    if (sets.length === 0) return false;

    sets.push("updated_at = ?");
    params.push(now);
    params.push(conversationId, userId);

    const result = this.connection
      .prepare(`UPDATE conversations SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`)
      .run(...params);
    return result.changes > 0;
  }

  deleteConversation(conversationId: string, userId: string): boolean {
    const result = this.connection
      .prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?")
      .run(conversationId, userId);
    return result.changes > 0;
  }

  searchConversations(input: {
    userId: string;
    organizationId: string;
    query: string;
    limit?: number;
  }): ConversationEntry[] {
    const limit = input.limit ?? 20;
    const pattern = `%${input.query}%`;

    const rows = this.connection
      .prepare(
        `SELECT DISTINCT c.*,
                (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) AS message_count,
                (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_preview,
                (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
         FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         WHERE c.user_id = ? AND c.organization_id = ? AND c.archived_at IS NULL
           AND (c.title LIKE ? OR m.content LIKE ?)
         ORDER BY c.updated_at DESC
         LIMIT ?`
      )
      .all(input.userId, input.organizationId, pattern, pattern, limit) as ConversationRow[];

    return rows.map((r) => this.mapConversationRow(r));
  }

  // ── Messages ──────────────────────────────────────────────────────────

  addMessage(input: {
    conversationId: string;
    role: "user" | "assistant" | "system";
    content: string;
    metadata?: Record<string, unknown>;
  }): MessageEntry {
    const id = randomUUID();
    const now = new Date().toISOString();
    const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

    this.connection
      .prepare(
        `INSERT INTO messages (id, conversation_id, role, content, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.conversationId, input.role, input.content, metadataJson, now);

    // Touch the conversation's updated_at
    this.connection
      .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .run(now, input.conversationId);

    return {
      id,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      metadata: input.metadata ?? null,
      createdAt: now
    };
  }

  listMessages(
    conversationId: string,
    userId: string,
    opts?: { limit?: number; before?: string }
  ): { messages: MessageEntry[]; hasMore: boolean } {
    // Verify ownership
    const conv = this.connection
      .prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?")
      .get(conversationId, userId) as { id: string } | undefined;
    if (!conv) return { messages: [], hasMore: false };

    const limit = (opts?.limit ?? 100) + 1;
    let rows: MessageRow[];

    if (opts?.before) {
      rows = this.connection
        .prepare(
          `SELECT * FROM messages
           WHERE conversation_id = ? AND created_at < ?
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(conversationId, opts.before, limit) as MessageRow[];
    } else {
      rows = this.connection
        .prepare(
          `SELECT * FROM messages
           WHERE conversation_id = ?
           ORDER BY created_at ASC LIMIT ?`
        )
        .all(conversationId, limit) as MessageRow[];
    }

    const hasMore = rows.length === limit;
    if (hasMore) rows.pop();

    // When fetching with "before", results come DESC — reverse to ASC
    if (opts?.before) rows.reverse();

    return {
      messages: rows.map((r) => this.mapMessageRow(r)),
      hasMore
    };
  }

  // ── Projects ──────────────────────────────────────────────────────────

  createProject(input: {
    organizationId: string;
    name: string;
    description?: string;
    instructions?: string;
    icon?: string;
  }): ProjectEntry {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.connection
      .prepare(
        `INSERT INTO projects (id, organization_id, name, description, instructions, icon, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.organizationId, input.name, input.description ?? null, input.instructions ?? null, input.icon ?? null, now, now);
    return {
      id,
      organizationId: input.organizationId,
      name: input.name,
      description: input.description ?? null,
      instructions: input.instructions ?? null,
      icon: input.icon ?? null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now
    };
  }

  listProjects(organizationId: string, includeArchived = false): ProjectEntry[] {
    const condition = includeArchived ? "" : " AND archived_at IS NULL";
    const rows = this.connection
      .prepare(`SELECT * FROM projects WHERE organization_id = ?${condition} ORDER BY name ASC`)
      .all(organizationId) as ProjectRow[];
    return rows.map((r) => this.mapProjectRow(r));
  }

  updateProject(
    projectId: string,
    organizationId: string,
    patch: { name?: string; description?: string; instructions?: string; icon?: string; archived?: boolean }
  ): boolean {
    const sets: string[] = [];
    const params: unknown[] = [];
    const now = new Date().toISOString();

    if (patch.name !== undefined) { sets.push("name = ?"); params.push(patch.name); }
    if (patch.description !== undefined) { sets.push("description = ?"); params.push(patch.description); }
    if (patch.instructions !== undefined) { sets.push("instructions = ?"); params.push(patch.instructions); }
    if (patch.icon !== undefined) { sets.push("icon = ?"); params.push(patch.icon); }
    if (patch.archived !== undefined) { sets.push("archived_at = ?"); params.push(patch.archived ? now : null); }

    if (sets.length === 0) return false;

    sets.push("updated_at = ?");
    params.push(now);
    params.push(projectId, organizationId);

    const result = this.connection
      .prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ? AND organization_id = ?`)
      .run(...params);
    return result.changes > 0;
  }

  deleteProject(projectId: string, organizationId: string): boolean {
    // Unlink conversations first (ON DELETE SET NULL handles this, but be explicit)
    this.connection
      .prepare("UPDATE conversations SET project_id = NULL WHERE project_id = ?")
      .run(projectId);
    const result = this.connection
      .prepare("DELETE FROM projects WHERE id = ? AND organization_id = ?")
      .run(projectId, organizationId);
    return result.changes > 0;
  }

  // ── Row Mappers ───────────────────────────────────────────────────────

  private mapConversationRow(row: ConversationRow): ConversationEntry {
    return {
      id: row.id,
      organizationId: row.organization_id,
      userId: row.user_id,
      projectId: row.project_id,
      title: row.title,
      pinned: row.pinned === 1,
      archivedAt: row.archived_at,
      messageCount: row.message_count ?? 0,
      lastMessagePreview: row.last_message_preview ?? null,
      lastMessageAt: row.last_message_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapMessageRow(row: MessageRow): MessageEntry {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
      createdAt: row.created_at
    };
  }

  private mapProjectRow(row: ProjectRow): ProjectEntry {
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      description: row.description,
      instructions: row.instructions,
      icon: row.icon,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // ── Artifacts ──────────────────────────────────────────────────────────

  createArtifact(input: {
    organizationId: string;
    userId: string;
    conversationId?: string;
    messageId?: string;
    kind: ArtifactKind;
    title: string;
    spec: ArtifactSpec;
    driveFolderId?: string;
    sourceArtifactId?: string;
  }): ArtifactRecord {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.connection
      .prepare(
        `INSERT INTO artifacts (
          id, organization_id, user_id, conversation_id, message_id,
          kind, status, title, drive_file_id, web_view_link,
          mime_type, drive_folder_id, source_artifact_id, spec_json,
          error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.organizationId,
        input.userId,
        input.conversationId ?? null,
        input.messageId ?? null,
        input.kind,
        "creating",
        input.title,
        null,
        null,
        null,
        input.driveFolderId ?? null,
        input.sourceArtifactId ?? null,
        JSON.stringify(input.spec),
        null,
        now,
        now
      );

    return this.mapArtifactRow(
      this.connection
        .prepare("SELECT * FROM artifacts WHERE id = ?")
        .get(id) as ArtifactRow
    );
  }

  updateArtifactStatus(
    artifactId: string,
    status: ArtifactStatus,
    updates?: {
      driveFileId?: string;
      webViewLink?: string;
      mimeType?: string;
      errorMessage?: string;
    }
  ): ArtifactRecord | null {
    const now = new Date().toISOString();
    this.connection
      .prepare(
        `UPDATE artifacts SET
          status = ?,
          drive_file_id = COALESCE(?, drive_file_id),
          web_view_link = COALESCE(?, web_view_link),
          mime_type = COALESCE(?, mime_type),
          error_message = ?,
          updated_at = ?
        WHERE id = ?`
      )
      .run(
        status,
        updates?.driveFileId ?? null,
        updates?.webViewLink ?? null,
        updates?.mimeType ?? null,
        updates?.errorMessage ?? null,
        now,
        artifactId
      );

    const row = this.connection
      .prepare("SELECT * FROM artifacts WHERE id = ?")
      .get(artifactId) as ArtifactRow | undefined;

    return row ? this.mapArtifactRow(row) : null;
  }

  getArtifact(artifactId: string, userId: string): ArtifactRecord | null {
    const row = this.connection
      .prepare("SELECT * FROM artifacts WHERE id = ? AND user_id = ?")
      .get(artifactId, userId) as ArtifactRow | undefined;
    return row ? this.mapArtifactRow(row) : null;
  }

  getArtifactById(artifactId: string): ArtifactRecord | null {
    const row = this.connection
      .prepare("SELECT * FROM artifacts WHERE id = ?")
      .get(artifactId) as ArtifactRow | undefined;
    return row ? this.mapArtifactRow(row) : null;
  }

  listArtifacts(input: {
    userId: string;
    organizationId: string;
    conversationId?: string;
    limit?: number;
    offset?: number;
  }): { artifacts: ArtifactRecord[]; total: number } {
    const conditions = ["user_id = ?", "organization_id = ?"];
    const params: unknown[] = [input.userId, input.organizationId];

    if (input.conversationId) {
      conditions.push("conversation_id = ?");
      params.push(input.conversationId);
    }

    const where = conditions.join(" AND ");

    const total = (
      this.connection
        .prepare(`SELECT COUNT(*) as count FROM artifacts WHERE ${where}`)
        .get(...params) as { count: number }
    ).count;

    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;

    const rows = this.connection
      .prepare(
        `SELECT * FROM artifacts WHERE ${where}
         ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as ArtifactRow[];

    return {
      artifacts: rows.map((r) => this.mapArtifactRow(r)),
      total
    };
  }

  listConversationArtifacts(conversationId: string): ArtifactRecord[] {
    const rows = this.connection
      .prepare(
        "SELECT * FROM artifacts WHERE conversation_id = ? ORDER BY created_at ASC"
      )
      .all(conversationId) as ArtifactRow[];
    return rows.map((r) => this.mapArtifactRow(r));
  }

  private mapArtifactRow(row: ArtifactRow): ArtifactRecord {
    return {
      id: row.id,
      organizationId: row.organization_id,
      userId: row.user_id,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      kind: row.kind as ArtifactKind,
      status: row.status as ArtifactStatus,
      title: row.title,
      driveFileId: row.drive_file_id,
      webViewLink: row.web_view_link,
      mimeType: row.mime_type,
      driveFolderId: row.drive_folder_id,
      sourceArtifactId: row.source_artifact_id,
      spec: parseJson<ArtifactSpec>(row.spec_json, { type: "doc", content: "" }),
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  close(): void {
    this.connection.close();
  }
}

export function initializeDatabase(config: AppConfig): AppDatabase {
  ensureDatabaseDirectory(config.databasePath);

  const connection = new Database(config.databasePath);
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");

  connection.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organization_memberships (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'support')),
      created_at TEXT NOT NULL,
      UNIQUE(organization_id, user_id),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_org_memberships_user
      ON organization_memberships(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_org_memberships_org
      ON organization_memberships(organization_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS organization_settings (
      organization_id TEXT PRIMARY KEY,
      team_members_json TEXT NOT NULL,
      tracked_repos_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS organization_invitations (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'support')),
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      created_at TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_org_invitations_org_created
      ON organization_invitations(organization_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_org_invitations_token
      ON organization_invitations(token);

    CREATE TABLE IF NOT EXISTS jira_connections (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL UNIQUE,
      secret_ref TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      last_validated_at TEXT,
      last_error TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS github_connections (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL UNIQUE,
      secret_ref TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      last_validated_at TEXT,
      last_error TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_provider_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('github', 'jira', 'google')),
      status TEXT NOT NULL CHECK (status IN ('connected', 'disconnected')),
      external_account_id TEXT,
      display_name TEXT,
      login TEXT,
      email TEXT,
      auth_method TEXT NOT NULL CHECK (auth_method IN ('oauth')),
      connected_at TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, provider),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_provider_connections_user
      ON user_provider_connections(user_id, provider);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_provider_connections_external
      ON user_provider_connections(provider, external_account_id)
      WHERE external_account_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS llm_provider_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('openai', 'gemini', 'claude')),
      display_label TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      connected_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, provider),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_llm_provider_keys_user
      ON llm_provider_keys(user_id);

    CREATE TABLE IF NOT EXISTS query_runs (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      query_text TEXT NOT NULL,
      response_text TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_query_runs_org_created
      ON query_runs(organization_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      actor_user_id TEXT,
      event_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_events_org_created
      ON audit_events(organization_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS background_jobs (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_background_jobs_org_created
      ON background_jobs(organization_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS query_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      query_text TEXT NOT NULL,
      response_text TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
      ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      instructions TEXT,
      icon TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_projects_org
      ON projects(organization_id, archived_at);

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      title TEXT NOT NULL DEFAULT 'New chat',
      pinned INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_user_org
      ON conversations(user_id, organization_id, archived_at);

    CREATE INDEX IF NOT EXISTS idx_conversations_project
      ON conversations(project_id);

    CREATE INDEX IF NOT EXISTS idx_conversations_updated
      ON conversations(organization_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      conversation_id TEXT,
      message_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN (
        'google_doc', 'google_sheet', 'google_slides',
        'chart', 'xlsx_export', 'pptx_export', 'pdf_export'
      )),
      status TEXT NOT NULL CHECK (status IN ('creating', 'ready', 'failed')),
      title TEXT NOT NULL,
      drive_file_id TEXT,
      web_view_link TEXT,
      mime_type TEXT,
      drive_folder_id TEXT,
      source_artifact_id TEXT,
      spec_json TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
      FOREIGN KEY (source_artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_artifacts_user_org
      ON artifacts(user_id, organization_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_artifacts_conversation
      ON artifacts(conversation_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_artifacts_drive_file
      ON artifacts(drive_file_id)
      WHERE drive_file_id IS NOT NULL;
  `);

  const needsProviderMigration = (() => {
    const tableInfo = connection
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='user_provider_connections'`)
      .get() as { sql: string } | undefined;
    return tableInfo?.sql && !tableInfo.sql.includes("'google'");
  })();

  const needsTokenColumns = (() => {
    const columns = connection
      .prepare(`PRAGMA table_info(user_provider_connections)`)
      .all() as Array<{ name: string }>;
    return !columns.some((col) => col.name === "encrypted_access_token");
  })();

  if (needsProviderMigration) {
    connection.exec(`
      CREATE TABLE IF NOT EXISTS user_provider_connections_new (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('github', 'jira', 'google')),
        status TEXT NOT NULL CHECK (status IN ('connected', 'disconnected')),
        external_account_id TEXT,
        display_name TEXT,
        login TEXT,
        email TEXT,
        auth_method TEXT NOT NULL CHECK (auth_method IN ('oauth')),
        connected_at TEXT,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, provider),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      INSERT INTO user_provider_connections_new
        SELECT * FROM user_provider_connections;

      DROP TABLE user_provider_connections;

      ALTER TABLE user_provider_connections_new RENAME TO user_provider_connections;

      CREATE INDEX IF NOT EXISTS idx_user_provider_connections_user
        ON user_provider_connections(user_id, provider);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_provider_connections_external
        ON user_provider_connections(provider, external_account_id)
        WHERE external_account_id IS NOT NULL;
    `);
  }

  if (needsTokenColumns) {
    connection.exec(`
      ALTER TABLE user_provider_connections ADD COLUMN encrypted_access_token TEXT;
      ALTER TABLE user_provider_connections ADD COLUMN encrypted_refresh_token TEXT;
      ALTER TABLE user_provider_connections ADD COLUMN token_expires_at TEXT;
    `);
  }

  const database = new AppDatabase(connection, {
    teamMembers: config.teamMembers,
    trackedRepos: config.trackedRepos,
    defaultConnectionStatus: config.useRecordedFixtures ? "connected" : "pending",
    encryptionSecret: config.sessionSecret
  });

  database.cleanupExpiredSessions();
  database.backfillLegacyUsers();
  return database;
}
