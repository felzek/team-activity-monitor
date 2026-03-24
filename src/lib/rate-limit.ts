import type { NextFunction, Request, Response } from "express";

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export function createRateLimitMiddleware(options: {
  windowMs: number;
  maxRequests: number;
}) {
  const buckets = new Map<string, RateLimitBucket>();

  return (request: Request, response: Response, next: NextFunction): void => {
    if (!request.path.startsWith("/api/")) {
      next();
      return;
    }

    const now = Date.now();
    const key = [
      request.session.userId ?? "anonymous",
      request.session.currentOrganizationId ?? "no-org",
      request.ip
    ].join(":");

    const existing = buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      buckets.set(key, {
        count: 1,
        resetAt: now + options.windowMs
      });
      next();
      return;
    }

    if (existing.count >= options.maxRequests) {
      response.setHeader("Retry-After", Math.ceil((existing.resetAt - now) / 1000));
      response.status(429).json({
        error: "Rate limit exceeded. Please slow down and try again shortly."
      });
      return;
    }

    existing.count += 1;
    buckets.set(key, existing);
    next();
  };
}
