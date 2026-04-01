import { create } from "zustand";

interface SessionStore {
  csrfToken: string | null;
  currentOrgId: string | null;
  userDisplayName: string | null;
  userEmail: string | null;
  orgName: string | null;
  setCsrfToken: (token: string | null) => void;
  setCurrentOrgId: (id: string | null) => void;
  setUser: (name: string, email: string) => void;
  setOrgName: (name: string) => void;
}

export const useSessionStore = create<SessionStore>()((set) => ({
  csrfToken: null,
  currentOrgId: null,
  userDisplayName: null,
  userEmail: null,
  orgName: null,
  setCsrfToken: (token) => set({ csrfToken: token }),
  setCurrentOrgId: (id) => set({ currentOrgId: id }),
  setUser: (name, email) => set({ userDisplayName: name, userEmail: email }),
  setOrgName: (name) => set({ orgName: name }),
}));
