# Generic Tracker Mapping

| Normalized field | Generic tracker field |
|---|---|
| `ticket_key` | External ID / reference |
| `issue_type` | Type |
| `title` | Title / summary |
| `summary` | Description intro |
| `background_rationale` | Why / context |
| `scope` | In scope |
| `out_of_scope` | Out of scope |
| `acceptance_criteria` | Acceptance criteria |
| `dependencies` | Blocked by / related |
| `priority` | Priority |
| `estimate` | Estimate |
| `owner_role` | Assignee / owner lane |
| `labels` | Labels |
| `risk_level` | Custom field or label |
| `demo_relevance` | Custom field or label |
| `artifacts_or_files_expected` | Files / artifacts |
| `test_notes` | QA notes |
| `rollback_or_fallback` | Rollback / fallback |
| `suggested_status` | Initial status |

## Taiga note

- Taiga has API-based issue creation and importers.
- Jira importer compatibility is not a safe assumption for Jira Cloud review workflows.
- Prefer manual or API creation from [`planning/backlog.json`](/Users/admin/autonomize/planning/backlog.json) or [`planning/backlog.csv`](/Users/admin/autonomize/planning/backlog.csv).
