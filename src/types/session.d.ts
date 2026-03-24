import "express-session";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    currentOrganizationId?: string;
    csrfToken?: string;
  }
}
