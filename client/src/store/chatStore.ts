import { create } from "zustand";
import { apiFetch } from "@/api/client";
import type {
  ConversationEntry,
  ConversationListResponse,
  MessagesResponse,
  ProjectEntry,
} from "@/api/types";

interface ChatStore {
  // State
  conversations: ConversationEntry[];
  projects: ProjectEntry[];
  activeConversationId: string | null;
  sidebarOpen: boolean;
  searchQuery: string;
  loading: boolean;
  error: string | null;

  // Actions
  loadConversations: () => Promise<void>;
  loadProjects: () => Promise<void>;
  createConversation: (opts?: { title?: string; projectId?: string }) => Promise<ConversationEntry>;
  setActiveConversation: (id: string | null) => void;
  updateConversation: (id: string, patch: { title?: string; pinned?: boolean; archived?: boolean; projectId?: string | null }) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  searchConversations: (query: string) => Promise<ConversationEntry[]>;
  loadMessages: (conversationId: string) => Promise<MessagesResponse>;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSearchQuery: (q: string) => void;

  // Project actions
  createProject: (name: string, opts?: { description?: string; instructions?: string }) => Promise<ProjectEntry>;
  deleteProject: (id: string) => Promise<void>;
}

export const useChatStore = create<ChatStore>()((set, get) => ({
  conversations: [],
  projects: [],
  activeConversationId: null,
  sidebarOpen: true,
  searchQuery: "",
  loading: false,
  error: null,

  loadConversations: async () => {
    set({ loading: true, error: null });
    try {
      const data = await apiFetch<ConversationListResponse>("/api/v1/conversations?limit=100");
      set({ conversations: data.conversations, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  loadProjects: async () => {
    try {
      const data = await apiFetch<{ projects: ProjectEntry[] }>("/api/v1/projects");
      set({ projects: data.projects });
    } catch {
      // Non-critical
    }
  },

  createConversation: async (opts) => {
    const conv = await apiFetch<ConversationEntry>("/api/v1/conversations", {
      method: "POST",
      body: JSON.stringify(opts ?? {}),
    });
    set((s) => ({ conversations: [conv, ...s.conversations], activeConversationId: conv.id }));
    return conv;
  },

  setActiveConversation: (id) => set({ activeConversationId: id }),

  updateConversation: async (id, patch) => {
    const updated = await apiFetch<ConversationEntry>(`/api/v1/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? updated : c)),
    }));
  },

  deleteConversation: async (id) => {
    await apiFetch(`/api/v1/conversations/${id}`, { method: "DELETE" });
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
    }));
  },

  searchConversations: async (query) => {
    if (!query.trim()) return get().conversations;
    const data = await apiFetch<{ results: ConversationEntry[] }>(
      `/api/v1/conversations/search?q=${encodeURIComponent(query)}`,
    );
    return data.results;
  },

  loadMessages: async (conversationId) => {
    return apiFetch<MessagesResponse>(`/api/v1/conversations/${conversationId}/messages`);
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  setSearchQuery: (q) => set({ searchQuery: q }),

  createProject: async (name, opts) => {
    const project = await apiFetch<ProjectEntry>("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({ name, ...opts }),
    });
    set((s) => ({ projects: [...s.projects, project] }));
    return project;
  },

  deleteProject: async (id) => {
    await apiFetch(`/api/v1/projects/${id}`, { method: "DELETE" });
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
  },
}));
