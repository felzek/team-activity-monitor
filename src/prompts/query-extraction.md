Parse the user query into JSON with this schema:

```json
{
  "member_text": "string",
  "intent": "activity_summary | jira_only | github_commits | github_prs",
  "requested_sources": ["jira", "github"],
  "timeframe_kind": "trailing_days | calendar_week | explicit_range",
  "timeframe_days": "number | null",
  "timeframe_start": "string | null",
  "timeframe_end": "string | null",
  "needs_clarification": "boolean",
  "clarification_reason": "string | null"
}
```

Rules:
- "these days" means the trailing 14 days.
- "recent activity" means the trailing 7 days.
- "this week" means the current calendar week in the configured app timezone.
- If the teammate is missing or ambiguous, set `needs_clarification` to `true`.
- Return JSON only.
