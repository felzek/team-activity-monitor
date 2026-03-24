import { randomUUID } from "node:crypto";

import type { Request, Response } from "express";
import pino, { type Logger } from "pino";
import { pinoHttp } from "pino-http";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "headers.authorization",
      "jiraApiToken",
      "githubToken",
      "openAiApiKey"
    ],
    censor: "[Redacted]"
  }
});

export function createHttpLogger() {
  return pinoHttp<Request, Response>({
    logger,
    quietReqLogger: true,
    genReqId: () => randomUUID(),
    autoLogging: {
      ignore: (request: Request) => request.url === "/api/health"
    },
    serializers: {
      req(request: Request) {
        return {
          id: request.id,
          method: request.method,
          url: request.url
        };
      },
      res(response: Response) {
        return {
          statusCode: response.statusCode
        };
      }
    }
  });
}

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
