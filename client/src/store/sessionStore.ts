import { create } from "zustand";
import type { GuestAccess } from "@/api/types";

interface SessionStore {
  authenticated: boolean;
  csrfToken: string | null;
  currentOrgId: string | null;
  userDisplayName: string | null;
  userEmail: string | null;
  orgName: string | null;
  guestAccess: GuestAccess | null;
  connectedLlmProviders: Array<"openai" | "gemini" | "claude">;
  authModalOpen: boolean;
  authModalMode: "login" | "register";
  setSession: (session: {
    authenticated: boolean;
    csrfToken: string | null;
    currentOrgId: string | null;
    userDisplayName: string | null;
    userEmail: string | null;
    orgName: string | null;
    guestAccess: GuestAccess | null;
    connectedLlmProviders: Array<"openai" | "gemini" | "claude">;
  }) => void;
  setGuestAccess: (guestAccess: GuestAccess | null) => void;
  openAuthModal: (mode?: "login" | "register") => void;
  closeAuthModal: () => void;
}

export const useSessionStore = create<SessionStore>()((set) => ({
  authenticated: false,
  csrfToken: null,
  currentOrgId: null,
  userDisplayName: null,
  userEmail: null,
  orgName: null,
  guestAccess: null,
  connectedLlmProviders: [],
  authModalOpen: false,
  authModalMode: "login",
  setSession: (session) =>
    set((state) => ({
      authenticated: session.authenticated,
      csrfToken: session.csrfToken,
      currentOrgId: session.currentOrgId,
      userDisplayName: session.userDisplayName,
      userEmail: session.userEmail,
      orgName: session.orgName,
      guestAccess: session.guestAccess,
      connectedLlmProviders: session.connectedLlmProviders,
      authModalOpen: session.authenticated ? false : state.authModalOpen,
    })),
  setGuestAccess: (guestAccess) => set({ guestAccess }),
  openAuthModal: (mode = "login") => set({ authModalOpen: true, authModalMode: mode }),
  closeAuthModal: () => set({ authModalOpen: false }),
}));
