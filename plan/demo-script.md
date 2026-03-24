# Demo Script

## 1. Setup framing

- Open the app and say the prototype answers one grounded question well:
  - "What is [member] working on these days?"
- Call out the guardrails:
  - repo allow-list
  - alias mapping
  - fixture fallback mode

## 2. Show the config

- Open [`config/team-members.json`](/Users/admin/autonomize/config/team-members.json)
- Open [`config/repos.json`](/Users/admin/autonomize/config/repos.json)
- Explain that GitHub is intentionally bounded to known repos for demo reliability

## 3. Happy-path query

- Run: `What is John working on these days?`
- Narrate:
  - Jira shows assigned work
  - GitHub shows recent coding activity
  - Caveats stay explicit

## 4. GitHub-focused query

- Run: `Show me Lisa's recent pull requests`
- Point at:
  - open PRs
  - recently updated PRs
  - repo coverage

## 5. Negative-case query

- Run: `Show me recent activity for Sarah`
- Explain the no-activity behavior:
  - not an error
  - explicit empty-state language

## 6. If live integrations fail

- Switch to fixture mode
- Say:
  - "The system is still using the same parser, orchestrator, renderer, and UI path."
  - "Only the provider data source changed from live APIs to recorded fixtures."

## 7. Close with tradeoffs

- deterministic grounded answers over agentic improvisation
- web-first UI with CLI fallback
- no GitHub Events dependency because freshness is not guaranteed
