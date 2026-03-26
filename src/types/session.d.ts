import "express-session";
import type { ProviderAuthFlowState, ProviderAuthProvider } from "./auth.js";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    currentOrganizationId?: string;
    csrfToken?: string;
    providerAuthFlows?: Partial<Record<ProviderAuthProvider, ProviderAuthFlowState>>;
    demoOrganizationId?: string;
    demoUserId?: string;
  }
}
