import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import type { SessionData, Store } from "express-session";
import session from "express-session";

import type { AppConfig } from "./config.js";
import type { ActivitySummary, TeamMember, TrackedRepo } from "./types/activity.js";
import { decrypt, encrypt, maskApiKey } from "./lib/encryption.js";
import type {
  AuditEventEntry,
  ConnectionStatus,
  ConnectorRecord,
  InvitationEntry,
  LlmProvider,
  LlmProviderKey,
  OrganizationMemberEntry,
  OrganizationRole,
  OrganizationSettings,
  OrganizationSummary,
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
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, provider) DO UPDATE SET
          status = excluded.status,
          external_account_id = excluded.external_account_id,
          display_name = excluded.display_name,
          login = excluded.login,
          email = excluded.email,
          auth_method = excluded.auth_method,
          connected_at = excluded.connected_at,
          metadata_json = excluded.metadata_json,
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
      metadata: {}
    });
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

    this.createBackgroundJob({
      organizationId: input.organizationId,
      jobType: "invite_delivery",
      payload: {
        email: input.email.toLowerCase(),
        role: input.role,
        token
      }
    });

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
  `);

  const needsProviderMigration = (() => {
    const tableInfo = connection
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='user_provider_connections'`)
      .get() as { sql: string } | undefined;
    return tableInfo?.sql && !tableInfo.sql.includes("'google'");
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
