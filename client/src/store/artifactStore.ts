import { create } from "zustand";
import { apiFetch } from "@/api/client";
import type {
  ArtifactMetadata,
  ArtifactSuggestion,
  CreateArtifactRequest,
} from "@/api/types";

interface ArtifactStore {
  /** Artifacts keyed by ID for fast lookup and live updates. */
  artifacts: Record<string, ArtifactMetadata>;
  /** Poll timers for "creating" artifacts. */
  pollingIds: Set<string>;

  createArtifact: (request: CreateArtifactRequest) => Promise<ArtifactMetadata>;
  pollArtifact: (id: string) => void;
  stopPolling: (id: string) => void;
  retryArtifact: (id: string) => Promise<ArtifactMetadata>;
  shareArtifact: (id: string, email: string, role: "reader" | "writer" | "commenter") => Promise<void>;
  exportArtifact: (id: string, format: "xlsx" | "pptx" | "pdf" | "docx") => Promise<ArtifactMetadata>;
  loadConversationArtifacts: (conversationId: string) => Promise<void>;
  getArtifact: (id: string) => ArtifactMetadata | undefined;
}

const POLL_INTERVAL = 1500;
const MAX_POLLS = 40; // ~60 seconds

export const useArtifactStore = create<ArtifactStore>()((set, get) => ({
  artifacts: {},
  pollingIds: new Set(),

  createArtifact: async (request) => {
    const metadata = await apiFetch<ArtifactMetadata>("/api/v1/artifacts", {
      method: "POST",
      body: JSON.stringify(request),
    });
    set((s) => ({ artifacts: { ...s.artifacts, [metadata.id]: metadata } }));

    // Start polling if creating
    if (metadata.status === "creating") {
      get().pollArtifact(metadata.id);
    }

    return metadata;
  },

  pollArtifact: (id) => {
    const { pollingIds } = get();
    if (pollingIds.has(id)) return;

    set((s) => ({ pollingIds: new Set([...s.pollingIds, id]) }));

    let count = 0;
    const interval = setInterval(async () => {
      count++;
      try {
        const updated = await apiFetch<ArtifactMetadata>(`/api/v1/artifacts/${id}`);
        set((s) => ({ artifacts: { ...s.artifacts, [id]: updated } }));

        if (updated.status !== "creating" || count >= MAX_POLLS) {
          clearInterval(interval);
          get().stopPolling(id);
        }
      } catch {
        clearInterval(interval);
        get().stopPolling(id);
      }
    }, POLL_INTERVAL);
  },

  stopPolling: (id) => {
    set((s) => {
      const next = new Set(s.pollingIds);
      next.delete(id);
      return { pollingIds: next };
    });
  },

  retryArtifact: async (id) => {
    const metadata = await apiFetch<ArtifactMetadata>(`/api/v1/artifacts/${id}/retry`, {
      method: "POST",
    });
    set((s) => ({ artifacts: { ...s.artifacts, [id]: metadata } }));
    if (metadata.status === "creating") {
      get().pollArtifact(id);
    }
    return metadata;
  },

  shareArtifact: async (id, email, role) => {
    await apiFetch(`/api/v1/artifacts/${id}/share`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    });
  },

  exportArtifact: async (id, format) => {
    const metadata = await apiFetch<ArtifactMetadata>(`/api/v1/artifacts/${id}/export`, {
      method: "POST",
      body: JSON.stringify({ format }),
    });
    set((s) => ({ artifacts: { ...s.artifacts, [metadata.id]: metadata } }));
    if (metadata.status === "creating") {
      get().pollArtifact(metadata.id);
    }
    return metadata;
  },

  loadConversationArtifacts: async (conversationId) => {
    const data = await apiFetch<{ artifacts: ArtifactMetadata[] }>(
      `/api/v1/artifacts/conversation/${conversationId}`
    );
    const map: Record<string, ArtifactMetadata> = {};
    for (const a of data.artifacts) {
      map[a.id] = a;
    }
    set((s) => ({ artifacts: { ...s.artifacts, ...map } }));
  },

  getArtifact: (id) => get().artifacts[id],
}));
