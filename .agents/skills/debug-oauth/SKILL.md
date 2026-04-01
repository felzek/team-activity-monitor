---
name: debug-oauth
description: OAuth token debugging steps — DB inspection, token expiry, scope checks, reconnect flow for GitHub, Jira, and Google.
user-invocable: true
allowed-tools: Bash, Read
---

Debug OAuth connection issues for GitHub, Jira, or Google.

## Diagnostic flow

### 1. Check what connections exist in the DB

```bash
sqlite3 $(ls /tmp/test-*.db 2>/dev/null | head -1 || echo "autonomize.db") \
  "SELECT user_id, provider, created_at, json_extract(metadata_json,'$.scope') as scope, \
   json_extract(metadata_json,'$.webhookSecret') as webhook_secret \
   FROM user_provider_connections ORDER BY created_at DESC LIMIT 10;"
```

For the production DB, replace the path with the actual DB file (check `.env` for `DATABASE_PATH`).

### 2. Check token presence and shape

```bash
sqlite3 autonomize.db \
  "SELECT provider, length(access_token) as token_len, \
   token_expires_at, refresh_token IS NOT NULL as has_refresh \
   FROM user_provider_connections WHERE user_id = 'USER_ID';"
```

- `token_len = 0` → token not saved; OAuth callback failed silently
- `token_expires_at` in the past + no refresh token → user must reconnect
- `token_expires_at` NULL → provider doesn't expire tokens (GitHub PATs, Jira)

### 3. Test the token live

**GitHub:**
```bash
curl -H "Authorization: Bearer TOKEN" https://api.github.com/user
curl -H "Authorization: Bearer TOKEN" https://api.github.com/user/repos?per_page=5
```

Check response headers for scope: `X-OAuth-Scopes: repo, read:user, read:org`

**Jira:**
```bash
curl -H "Authorization: Bearer TOKEN" \
  "https://api.atlassian.com/oauth/token/accessible-resources"
# returns cloudId + URL for each site the token can access
```

**Google:**
```bash
curl "https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=TOKEN"
```

### 4. Check org-level connections (Jira/GitHub org settings)

```bash
sqlite3 autonomize.db \
  "SELECT org_id, provider, json_extract(metadata_json,'$.cloudId') as cloud_id, \
   json_extract(metadata_json,'$.webhookSecret') as wh_secret \
   FROM github_connections UNION ALL \
   SELECT org_id, 'jira', json_extract(metadata_json,'$.cloudId'), \
   json_extract(metadata_json,'$.webhookSecret') \
   FROM jira_connections;"
```

### 5. Force token refresh (if refresh token exists)

If `has_refresh = 1` and the token is expired, the app should auto-refresh on next use.
If auto-refresh is broken, manually trigger reconnect:

```
GET /auth/github    ← GitHub OAuth start
GET /auth/jira      ← Jira OAuth start
GET /auth/google    ← Google OAuth start
```

Check `src/routes/auth.ts` (or equivalent) for the exact callback URL registered with each provider.

### 6. Check scope mismatches

GitHub required scopes: `repo`, `read:user`, `read:org`
- Missing `repo` → 404 on private repo APIs
- Missing `read:org` → org member lookup fails

Jira required scopes: `read:jira-work`, `read:jira-user`
- Missing `read:jira-work` → JQL search returns 403

### 7. Check tracked repos / team members after reconnect

After fixing OAuth, check that profile sync ran and populated org settings:
```bash
sqlite3 autonomize.db \
  "SELECT org_id, json_extract(settings_json,'$.trackedRepos') as repos \
   FROM organization_settings LIMIT 3;"
```

If `trackedRepos` is empty or contains `acme/` fixture data, trigger a manual re-sync or check `src/lib/profile-sync.ts`.

## Common failure patterns

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| GitHub 404 on repo APIs | Stale `acme/` repos in org settings | Re-sync OAuth; repos replace on sync |
| Jira returns 0 issues | Wrong JQL (statusCategory filter) | JQL should be date-based, not status-based |
| 401 on all API calls | Token expired, no refresh | User must reconnect via `/auth/<provider>` |
| 403 on specific API | Scope missing | Re-authorize with correct scopes |
| `cloudId` null in Jira connection | OAuth callback didn't fetch accessible-resources | Check callback handler in auth routes |
