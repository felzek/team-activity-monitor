---
name: db-inspect
description: SQLite inspection commands for debugging — org settings, connections, sessions, audit events, and query history.
user-invocable: true
allowed-tools: Bash
---

Inspect the SQLite database for debugging.

## Find the DB file

```bash
# Dev DB (check .env for DATABASE_PATH, default is project root)
grep DATABASE_PATH .env 2>/dev/null || echo "autonomize.db"

# Test DBs (created per-test in /tmp)
ls -lt /tmp/test-*.db 2>/dev/null | head -5
```

## Common inspection queries

### Users and orgs

```bash
# All users
sqlite3 autonomize.db "SELECT id, email, created_at FROM users ORDER BY created_at DESC LIMIT 10;"

# Org memberships
sqlite3 autonomize.db "SELECT u.email, om.role, o.name FROM org_memberships om JOIN users u ON u.id = om.user_id JOIN organizations o ON o.id = om.org_id;"
```

### OAuth connections

```bash
# Provider connections — token presence + scopes
sqlite3 autonomize.db "
SELECT user_id, provider,
  length(access_token) AS token_len,
  token_expires_at,
  refresh_token IS NOT NULL AS has_refresh,
  json_extract(metadata_json,'$.scope') AS scope
FROM user_provider_connections
ORDER BY created_at DESC;"

# Org-level GitHub connections
sqlite3 autonomize.db "
SELECT org_id,
  json_extract(metadata_json,'$.installationId') AS install_id,
  json_extract(metadata_json,'$.webhookSecret') IS NOT NULL AS has_webhook_secret
FROM github_connections;"

# Org-level Jira connections
sqlite3 autonomize.db "
SELECT org_id,
  json_extract(metadata_json,'$.cloudId') AS cloud_id,
  json_extract(metadata_json,'$.webhookSecret') IS NOT NULL AS has_webhook_secret
FROM jira_connections;"
```

### Organization settings (tracked repos + team members)

```bash
# Tracked repos per org
sqlite3 autonomize.db "
SELECT org_id, json_each.value AS repo
FROM organization_settings, json_each(json_extract(settings_json,'$.trackedRepos'))
LIMIT 20;"

# Team members per org
sqlite3 autonomize.db "
SELECT org_id, json_extract(value,'$.name') AS name, json_extract(value,'$.githubLogin') AS github
FROM organization_settings, json_each(json_extract(settings_json,'$.teamMembers'))
LIMIT 20;"
```

### Sessions

```bash
# Active sessions
sqlite3 autonomize.db "SELECT sid, json_extract(sess,'$.user.email') AS email, expired FROM sessions WHERE expired > datetime('now') ORDER BY expired DESC LIMIT 10;"

# Expired sessions (should be cleaned up)
sqlite3 autonomize.db "SELECT count(*) AS expired_count FROM sessions WHERE expired <= datetime('now');"
```

### Audit events

```bash
# Recent audit events
sqlite3 autonomize.db "SELECT created_at, user_id, action, resource_id FROM audit_events ORDER BY created_at DESC LIMIT 20;"

# Webhook events specifically
sqlite3 autonomize.db "SELECT created_at, action, resource_id FROM audit_events WHERE action LIKE 'webhook.%' ORDER BY created_at DESC LIMIT 10;"
```

### Query history

```bash
# Recent query runs
sqlite3 autonomize.db "SELECT created_at, user_id, json_extract(summary_json,'$.query') AS query, json_extract(summary_json,'$.memberName') AS member FROM query_runs ORDER BY created_at DESC LIMIT 10;"
```

## Schema introspection

```bash
# List all tables
sqlite3 autonomize.db ".tables"

# Full schema for a table
sqlite3 autonomize.db ".schema organization_settings"

# Column names only
sqlite3 autonomize.db "PRAGMA table_info(user_provider_connections);"
```

## Quick one-liners for common debug scenarios

```bash
# Is the org missing tracked repos? (stale fixture data)
sqlite3 autonomize.db "SELECT org_id, json_extract(settings_json,'$.trackedRepos') FROM organization_settings;"

# Did a webhook arrive? (last 10 webhook audit events)
sqlite3 autonomize.db "SELECT created_at, action FROM audit_events WHERE action LIKE 'webhook.%' ORDER BY created_at DESC LIMIT 10;"

# Which user is connected to Jira?
sqlite3 autonomize.db "SELECT u.email, upc.token_expires_at FROM user_provider_connections upc JOIN users u ON u.id = upc.user_id WHERE upc.provider = 'jira';"

# Are there any failed test DBs left in /tmp?
ls -lh /tmp/test-*.db 2>/dev/null | wc -l
```

## Key facts

- Dev DB path from `.env` key `DATABASE_PATH`; default `autonomize.db` in project root
- Test DBs are created in `/tmp` with name `test-<uuid>.db` and cleaned up by `cleanupTestConfig()`
- JSON fields (`settings_json`, `metadata_json`, `summary_json`) use `json_extract()` for querying
- `organization_settings` has one row per org; settings are a JSON blob in `settings_json`
- `user_provider_connections` stores per-user OAuth tokens; `github_connections`/`jira_connections` store org-level data
