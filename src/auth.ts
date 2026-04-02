import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";

import type { AppDatabase } from "./db.js";
import { AppError } from "./lib/errors.js";
import type {
  OrganizationRole,
  ProviderAuthRequirement,
  ProviderAuthProvider,
  PublicUser
} from "./types/auth.js";

export function validateRegistrationInput(input: {
  name?: string;
  email?: string;
  password?: string;
  organizationName?: string;
  inviteToken?: string;
}): {
  name: string;
  email: string;
  password: string;
  organizationName: string | null;
  inviteToken: string | null;
} {
  const name = input.name?.trim() ?? "";
  const email = input.email?.trim().toLowerCase() ?? "";
  const password = input.password ?? "";
  const organizationName = input.organizationName?.trim() ?? "";
  const inviteToken = input.inviteToken?.trim() ?? "";

  if (name.length < 2) {
    throw new AppError("Name must be at least 2 characters long.", {
      code: "INVALID_NAME",
      statusCode: 400
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError("Enter a valid email address.", {
      code: "INVALID_EMAIL",
      statusCode: 400
    });
  }

  if (password.length < 8) {
    throw new AppError("Password must be at least 8 characters long.", {
      code: "INVALID_PASSWORD",
      statusCode: 400
    });
  }

  return {
    name,
    email,
    password,
    organizationName: organizationName || null,
    inviteToken: inviteToken || null
  };
}

export function validateInviteInput(input: {
  email?: string;
  role?: string;
}): { email: string; role: OrganizationRole } {
  const email = input.email?.trim().toLowerCase() ?? "";
  const role = (input.role?.trim().toLowerCase() ?? "member") as OrganizationRole;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError("Enter a valid email address for the invitation.", {
      code: "INVALID_INVITE_EMAIL",
      statusCode: 400
    });
  }

  if (!["owner", "admin", "member", "support"].includes(role)) {
    throw new AppError("Invalid organization role.", {
      code: "INVALID_ROLE",
      statusCode: 400
    });
  }

  return {
    email,
    role
  };
}

export function validateConnectorInput(input: {
  secretRef?: string | null;
  enabled?: boolean | string;
}): { secretRef: string | null; enabled: boolean } {
  const secretRef =
    typeof input.secretRef === "string" && input.secretRef.trim().length > 0
      ? input.secretRef.trim()
      : null;
  const enabled =
    typeof input.enabled === "boolean"
      ? input.enabled
      : typeof input.enabled === "string"
        ? input.enabled === "true"
        : true;

  return {
    secretRef,
    enabled
  };
}

export function validateProviderParam(value: string): ProviderAuthProvider {
  if (value === "github" || value === "jira" || value === "google") {
    return value;
  }

  throw new AppError("Unknown auth provider.", {
    code: "INVALID_PROVIDER",
    statusCode: 400
  });
}

export function validateProviderLoginInput(input: {
  email?: string;
  name?: string;
  organizationName?: string;
}): {
  email: string;
  name: string | null;
  organizationName: string | null;
} {
  const email = input.email?.trim().toLowerCase() ?? "";
  const name = input.name?.trim() ?? "";
  const organizationName = input.organizationName?.trim() ?? "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError("Enter a valid email address.", {
      code: "INVALID_EMAIL",
      statusCode: 400
    });
  }

  if (name && name.length < 2) {
    throw new AppError("Name must be at least 2 characters long when provided.", {
      code: "INVALID_NAME",
      statusCode: 400
    });
  }

  return {
    email,
    name: name || null,
    organizationName: organizationName || null
  };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export function ensureCsrfToken(
  request: Request,
  _response: Response,
  next: NextFunction
): void {
  request.session.csrfToken ??= randomUUID();
  next();
}

export function requireCsrf(
  request: Request,
  response: Response,
  next: NextFunction
): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    next();
    return;
  }

  const headerToken = request.headers["x-csrf-token"];
  if (!request.session.csrfToken || headerToken !== request.session.csrfToken) {
    response.status(403).json({
      error: "CSRF validation failed."
    });
    return;
  }

  next();
}

export function requireAuth(
  request: Request,
  response: Response,
  next: NextFunction
): void {
  if (!request.session.userId) {
    response.status(401).json({
      error: "You must be signed in to use this endpoint."
    });
    return;
  }

  next();
}

export function requireAuthPage(
  request: Request,
  response: Response,
  next: NextFunction
): void {
  if (!request.session.userId) {
    response.redirect("/app?auth=login");
    return;
  }

  next();
}

export function redirectAuthenticatedPage(
  request: Request,
  response: Response,
  next: NextFunction
): void {
  if (request.session.userId) {
    response.redirect("/app");
    return;
  }

  next();
}

export function requireOrganization(
  database: AppDatabase,
  allowedRoles?: OrganizationRole[]
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const userId = request.session.userId;
    const orgIdParam = Array.isArray(request.params.orgId)
      ? request.params.orgId[0]
      : request.params.orgId;
    const currentOrganizationId =
      orgIdParam || request.session.currentOrganizationId;

    if (!userId || !currentOrganizationId) {
      response.status(403).json({
        error: "An active organization is required."
      });
      return;
    }

    const organization = database.getOrganizationForUser(userId, currentOrganizationId);
    if (!organization) {
      response.status(403).json({
        error: "You do not have access to this organization."
      });
      return;
    }

    if (allowedRoles && !allowedRoles.includes(organization.role)) {
      response.status(403).json({
        error: "You do not have permission to perform this action."
      });
      return;
    }

    request.session.currentOrganizationId = organization.id;
    next();
  };
}

export function requireProviderConnections(
  database: AppDatabase,
  providers: ProviderAuthProvider[],
  decorateProviderAuth: (providerAuth: ProviderAuthRequirement) => ProviderAuthRequirement = (
    providerAuth
  ) => providerAuth
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const userId = request.session.userId;

    if (!userId) {
      response.status(401).json({
        error: "You must be signed in to use this endpoint."
      });
      return;
    }

    const providerAuth = decorateProviderAuth(
      database.getProviderAuthRequirement(userId, providers)
    );

    if (!providerAuth.allConnected) {
      response.status(403).json({
        error: `Connect ${providerAuth.missingProviders.join(" and ")} before using this endpoint.`,
        code: "PROVIDER_AUTH_REQUIRED",
        providerAuth
      });
      return;
    }

    next();
  };
}

export function toSessionUser(user: PublicUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt
  };
}
