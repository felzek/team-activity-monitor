---
name: add-webhook
description: Webhook handler checklist — signature verification, cache invalidation, audit log, fast 200 response.
user-invocable: true
allowed-tools: Read, Edit, Bash
---

Add a webhook handler for a new provider or event type.

## Steps

### 1. Read existing handlers for reference

- `src/webhooks/github.ts` — HMAC-SHA256 via `X-Hub-Signature-256` header
- `src/webhooks/jira.ts` — token-in-URL auth (`?org_id=...&token=...`)

### 2. Create `src/webhooks/<provider>.ts`

Use the factory pattern — takes `(database, cache, logger)`, returns an Express handler:

```typescript
import type { Request, Response } from "express";
import type { Database } from "../db.js";
import type { ActivityCache } from "../lib/cache.js";
import type { Logger } from "pino";

export function createYourWebhookHandler(database: Database, cache: ActivityCache, logger: Logger) {
  return async (req: Request, res: Response): Promise<void> => {
    // 1. VERIFY SIGNATURE — do this before anything else
    const isValid = verifySignature(req);
    if (!isValid) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    // 2. RESPOND FAST — provider may timeout if you don't ACK quickly
    res.status(200).json({ received: true });

    // 3. PROCESS ASYNC — do heavy work after ACK
    const event = req.headers["x-event-type"] as string;
    const payload = req.body;

    try {
      // 4. INVALIDATE CACHE
      const tag = `provider:resource:${payload.identifier}`;
      cache.invalidateByTag(tag);

      // 5. AUDIT LOG (fire-and-forget)
      database.recordAuditEvent({
        userId: "system",
        orgId: resolvedOrgId,
        action: `webhook.${event}`,
        resourceId: payload.id?.toString(),
      }).catch(err => logger.warn({ err }, "Failed to record webhook audit event"));

      logger.info({ event, id: payload.id }, "Webhook processed");
    } catch (err) {
      logger.error({ err, event }, "Webhook processing failed");
      // Do NOT re-throw — response already sent
    }
  };
}
```

### 3. Signature verification patterns

**HMAC-SHA256 (GitHub style):**
```typescript
import { createHmac, timingSafeEqual } from "crypto";

function verifyHmac(rawBody: Buffer, secret: string, signatureHeader: string): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  try {
    return timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}
```

**Token-in-URL (Jira style):**
```typescript
import { timingSafeEqual } from "crypto";

function verifyToken(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
```

### 4. Mount in `src/app.ts`

For HMAC handlers, capture raw body BEFORE json middleware:
```typescript
app.post(
  "/webhooks/yourprovider",
  express.raw({ type: "application/json" }),  // raw body for HMAC
  csrfExempt,  // webhooks are exempt from CSRF
  createYourWebhookHandler(database, cache, logger)
);
```

For token-in-URL handlers, standard JSON body is fine:
```typescript
app.post("/webhooks/yourprovider", createYourWebhookHandler(database, cache, logger));
```

Check how GitHub/Jira are mounted in `src/app.ts` for the exact CSRF bypass pattern.

### 5. Store webhook secret per org

Secrets should be stored in the provider connection row:
```typescript
// When registering the webhook with the provider:
const secret = generateWebhookSecret(); // crypto.randomBytes(32).toString("hex")
await database.updateConnectionMetadata(orgId, "yourprovider", { webhookSecret: secret });
```

### 6. No secret configured → warn and accept

During initial setup a secret may not be configured. Log a warning but don't reject:
```typescript
if (!secret) {
  logger.warn("No webhook secret configured — accepting unverified");
  // continue processing
}
```

### 7. Write a test

```typescript
it("rejects requests with invalid signature", async () => {
  const res = await request(app)
    .post("/webhooks/yourprovider")
    .set("x-signature", "sha256=invalid")
    .send({ event: "test" });
  expect(res.status).toBe(401);
});

it("invalidates cache on event", async () => {
  // send valid signed payload
  // assert cache.invalidateByTag was called
});
```

### 8. Typecheck + test

```bash
npm run typecheck && npm test
```

## Key facts

- Always respond with 200 before heavy processing — providers retry on timeout
- Always use `timingSafeEqual` for secret comparison — prevents timing attacks
- Raw body needed for HMAC: mount `express.raw()` before the handler
- `database.recordAuditEvent(...)` — NOT `logAuditEvent`
- Cache tag format: `"provider:resourcetype:identifier"` (matches what executor uses)
- Never throw after `res.json()` is called — Express will log an unhandled error
