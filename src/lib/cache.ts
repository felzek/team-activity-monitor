/**
 * In-memory TTL cache with tag-based invalidation.
 *
 * Design:
 *  - Entries expire after their TTL; get() returns null on expiry.
 *  - Tags allow bulk invalidation: invalidateByTag("github:prs:felzek/n8n")
 *    removes all entries that carry that tag.
 *  - source/cacheAgeMs metadata is returned with every hit so callers can
 *    surface freshness information to the UI.
 *
 * Thread-safety: Node.js is single-threaded so Map operations are atomic.
 * For multi-instance deployments, swap the Map for a Redis client behind
 * the same interface.
 */

export interface CacheHit<T> {
  data: T;
  /** Milliseconds since the entry was stored */
  cacheAgeMs: number;
  source: "cached";
  fetchedAt: string; // ISO timestamp of when the data was fetched from source
}

interface CacheEntry<T> {
  data: T;
  tags: string[];
  createdAt: number;   // Unix ms
  expiresAt: number;   // Unix ms
  fetchedAt: string;   // ISO string from the original fetch
}

export class ActivityCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  // tag → set of cache keys that carry that tag
  private readonly tagIndex = new Map<string, Set<string>>();

  /** Returns null on miss or expiry. */
  get<T>(key: string): CacheHit<T> | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.evict(key, entry);
      return null;
    }

    return {
      data: entry.data,
      cacheAgeMs: now - entry.createdAt,
      source: "cached",
      fetchedAt: entry.fetchedAt
    };
  }

  set<T>(key: string, data: T, ttlMs: number, tags: string[] = [], fetchedAt?: string): void {
    const now = Date.now();
    const entry: CacheEntry<T> = {
      data,
      tags,
      createdAt: now,
      expiresAt: now + ttlMs,
      fetchedAt: fetchedAt ?? new Date(now).toISOString()
    };

    // Remove old tag registrations for this key before overwriting
    const existing = this.store.get(key) as CacheEntry<unknown> | undefined;
    if (existing) {
      for (const tag of existing.tags) {
        this.tagIndex.get(tag)?.delete(key);
      }
    }

    this.store.set(key, entry as CacheEntry<unknown>);

    for (const tag of tags) {
      if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, new Set());
      this.tagIndex.get(tag)!.add(key);
    }
  }

  /**
   * Removes all entries tagged with the given tag.
   * Returns the number of entries invalidated.
   */
  invalidateByTag(tag: string): number {
    const keys = this.tagIndex.get(tag);
    if (!keys) return 0;

    let count = 0;
    for (const key of Array.from(keys)) {
      const entry = this.store.get(key);
      if (entry) {
        this.store.delete(key);
        // Clean up other tag references
        for (const t of entry.tags) {
          if (t !== tag) this.tagIndex.get(t)?.delete(key);
        }
        count++;
      }
    }
    this.tagIndex.delete(tag);
    return count;
  }

  /** Removes all entries whose key starts with the given prefix. */
  invalidateByPrefix(prefix: string): number {
    let count = 0;
    for (const [key, entry] of this.store) {
      if (key.startsWith(prefix)) {
        this.evict(key, entry);
        count++;
      }
    }
    return count;
  }

  /** Returns the number of live (non-expired) entries. */
  size(): number {
    const now = Date.now();
    let count = 0;
    for (const entry of this.store.values()) {
      if (now <= entry.expiresAt) count++;
    }
    return count;
  }

  /** Purge all expired entries. Call periodically if needed. */
  pruneExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.evict(key, entry);
        count++;
      }
    }
    return count;
  }

  private evict(key: string, entry: CacheEntry<unknown>): void {
    this.store.delete(key);
    for (const tag of entry.tags) {
      this.tagIndex.get(tag)?.delete(key);
    }
  }
}

// TTL constants (milliseconds) — kept centrally for consistency with webhook invalidation
export const CACHE_TTL = {
  JIRA_ISSUES: 45_000,          // 45 s  — invalidated on jira:issue_updated webhook
  GITHUB_COMMITS: 30_000,        // 30 s  — invalidated on push webhook
  GITHUB_PRS: 30_000,            // 30 s  — invalidated on pull_request webhook
  IDENTITY_RESOLUTION: 600_000,  // 10 min — stable; changes only on OAuth re-connect
  ORG_REPOS: 300_000,            // 5 min  — changes on profile sync
  ORG_TEAM_MEMBERS: 300_000,     // 5 min  — changes on OAuth sync
} as const;

// Build consistent cache keys
export const cacheKey = {
  jiraIssues: (accountId: string, since: string) =>
    `jira:issues:${accountId}:${since}`,

  githubCommits: (username: string, repo: string, since: string) =>
    `github:commits:${username}:${repo}:${since}`,

  githubPrs: (username: string, repo: string, since: string) =>
    `github:prs:${username}:${repo}:${since}`,

  identity: (orgId: string, nameLower: string) =>
    `identity:${orgId}:${nameLower}`,

  orgRepos: (orgId: string) =>
    `repos:${orgId}`,

  orgTeamMembers: (orgId: string) =>
    `members:${orgId}`
} as const;

// Build consistent cache tags for invalidation
export const cacheTag = {
  jiraIssues: (accountId: string) =>
    `jira:issues:${accountId}`,

  githubCommits: (ownerRepo: string) =>
    `github:commits:${ownerRepo}`,

  githubPrs: (ownerRepo: string) =>
    `github:prs:${ownerRepo}`,

  orgIdentity: (orgId: string) =>
    `identity:${orgId}`,

  orgRepos: (orgId: string) =>
    `repos:${orgId}`
} as const;

// Singleton shared across the process — passed explicitly to avoid global state in tests
let _sharedCache: ActivityCache | null = null;

export function getSharedCache(): ActivityCache {
  if (!_sharedCache) _sharedCache = new ActivityCache();
  return _sharedCache;
}
