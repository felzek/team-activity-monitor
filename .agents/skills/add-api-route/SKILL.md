---
name: add-api-route
description: Express route patterns for this project — auth middleware, CSRF, org scoping, error handling, and test patterns.
user-invocable: true
allowed-tools: Read, Edit, Bash
---

Add a new API route following the project's Express 5 conventions.

## Steps

### 1. Choose where to put the route

- **New resource type** → create `src/routes/<resource>.ts`, export a router, mount it in `src/app.ts`
- **Extension of existing resource** → add to the existing `src/routes/<resource>.ts`

### 2. Standard route skeleton

```typescript
import { Router } from "express";
import type { Database } from "../db.js";
import type { Logger } from "pino";
import { requireAuth } from "../middleware/auth.js";  // check actual path
import { AppError } from "../lib/errors.js";

export function createYourRouter(database: Database, logger: Logger): Router {
  const router = Router();

  // GET — no CSRF needed
  router.get("/your-resource/:id", requireAuth, async (req, res) => {
    const { orgId } = req.session.user!;  // always scope to org
    const item = await database.getYourResource(req.params.id, orgId);
    if (!item) throw new AppError("Not found", "NOT_FOUND", 404);
    res.json({ item });
  });

  // POST/PATCH/DELETE — CSRF enforced automatically by global middleware
  router.post("/your-resource", requireAuth, async (req, res) => {
    const { orgId, userId } = req.session.user!;
    // validate input with Zod at boundary
    const result = await database.createYourResource({ ...req.body, orgId });
    await database.recordAuditEvent({ userId, orgId, action: "your_resource.created", resourceId: result.id });
    res.status(201).json({ item: result });
  });

  return router;
}
```

### 3. Mount in `src/app.ts`

```typescript
import { createYourRouter } from "./routes/your-resource.js";
// inside createApp():
app.use("/api/v1", createYourRouter(database, logger));
```

### 4. Auth and org scoping checklist

- [ ] All routes behind `requireAuth` (or equivalent session check)
- [ ] Always filter DB queries by `orgId` from `req.session.user` — never trust client-supplied org ID
- [ ] Mutating routes (POST/PATCH/PUT/DELETE) automatically require CSRF — no extra work needed
- [ ] Audit sensitive actions with `database.recordAuditEvent(...)`

### 5. Error handling

Use `AppError` for known error cases — the global error handler translates it to JSON:
```typescript
throw new AppError("Human-readable message", "ERROR_CODE", httpStatusCode);
```

Do NOT catch-and-swallow errors in route handlers — let them propagate to the global handler.

### 6. Input validation

Validate at the route boundary with Zod:
```typescript
import { z } from "zod";
const BodySchema = z.object({ name: z.string().min(1), ... });
const body = BodySchema.parse(req.body); // throws ZodError on invalid input
```

ZodError is handled by the global error handler and returns a 400.

### 7. Write a test

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { buildTestConfig, cleanupTestConfig, postWithCsrf } from "./helpers.js";

describe("YOUR route", () => {
  let config: Awaited<ReturnType<typeof buildTestConfig>>;
  let app: Express;

  beforeEach(async () => {
    config = await buildTestConfig();
    app = createApp(config.config, config.logger, config.database);
    // seed a user + session
  });

  afterEach(() => cleanupTestConfig(config));

  it("GET returns 200", async () => {
    const res = await request(app).get("/api/v1/your-resource/123").set("Cookie", sessionCookie);
    expect(res.status).toBe(200);
  });

  it("POST requires CSRF", async () => {
    // use postWithCsrf helper from tests/app.test.ts
    const res = await postWithCsrf(app, "/api/v1/your-resource", { name: "test" }, sessionCookie);
    expect(res.status).toBe(201);
  });
});
```

### 8. Typecheck + test

```bash
npm run typecheck && npm test
```

## Key facts

- CSRF is global middleware — POST/PATCH/PUT/DELETE always require `x-csrf-token` header
- Session user is at `req.session.user` — typed as `SessionUser` in `src/types/auth.ts`
- `database.recordAuditEvent(...)` — NOT `logAuditEvent`
- AppError codes are free-form strings; use SCREAMING_SNAKE_CASE by convention
- Express 5 async errors propagate automatically — no need for `next(err)` wrappers
