---
name: typecheck-test
description: Run TypeScript typecheck and Vitest tests after any code change. Use this after editing source files to verify nothing is broken.
user-invocable: true
allowed-tools: Bash
argument-hint: "[test-file-or-pattern]"
---

Run the project's full quality gate after code changes.

## Steps

1. **Typecheck first** — always run this before tests; a type error means tests may not reflect the real problem:
   ```bash
   npm run typecheck
   ```
   If this fails, fix all type errors before proceeding. Do not move to step 2.

2. **Run tests** — use the argument if provided, otherwise run the full suite:
   - If $ARGUMENTS is a file path: `npx vitest run $ARGUMENTS`
   - If $ARGUMENTS is a test name pattern: `npx vitest run -t "$ARGUMENTS"`
   - If no argument: `npm test`

3. **Report results** — summarize in one line: `✓ typecheck clean · N tests passed` or list failures with file:line references.

## Key facts about this project's tests
- Each test gets an isolated SQLite DB in `/tmp` — no shared state between tests
- Mutating API routes require a CSRF token from `GET /api/v1/auth/session` (header: `x-csrf-token`)
- Fixture mode (`USE_RECORDED_FIXTURES=true`) loads from `fixtures/demo/` — no real credentials needed
- Mock Ollama responses with `mockLocalModelResponse()` from `tests/helpers.ts`
- All local imports use `.js` extensions even though source is `.ts` (NodeNext module resolution)

## Common failure patterns
- `Cannot find name 'X'` → missing import or wrong function name — check `src/db.ts` method names
- `Type '"foo"' is not assignable` → literal type mismatch — use `as const` or fix the type
- `401 Unauthorized` in tests → missing CSRF token on mutating request
- `ENOENT fixture file` → `USE_RECORDED_FIXTURES=true` but fixture file missing; set to `false`
