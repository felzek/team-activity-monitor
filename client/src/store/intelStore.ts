import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type TimeRange = "1d" | "7d" | "14d" | "30d";
export type Source = "github" | "jira";

export interface IntelFilter {
  person: string | null;
  timeRange: TimeRange;
  sources: Source[];
}

interface IntelStore {
  filter: IntelFilter;
  setFilter: (patch: Partial<IntelFilter>) => void;
  resetFilter: () => void;
  boardUrl: () => string;
  initFromUrl: () => void;
}

const DEFAULT_FILTER: IntelFilter = {
  person: null,
  timeRange: "7d",
  sources: ["github", "jira"],
};

export const useIntelStore = create<IntelStore>()(
  persist(
    (set, get) => ({
      filter: { ...DEFAULT_FILTER, sources: [...DEFAULT_FILTER.sources] },

      setFilter: (patch) =>
        set((state) => ({ filter: { ...state.filter, ...patch } })),

      resetFilter: () =>
        set({ filter: { ...DEFAULT_FILTER, sources: [...DEFAULT_FILTER.sources] } }),

      boardUrl: () => {
        const { filter } = get();
        const u = new URL("/intelligence", window.location.origin);
        if (filter.person) u.searchParams.set("person", filter.person);
        if (filter.timeRange !== "7d") u.searchParams.set("timeRange", filter.timeRange);
        const allSources =
          filter.sources.includes("github") && filter.sources.includes("jira");
        if (!allSources) u.searchParams.set("sources", filter.sources.join(","));
        return u.pathname + u.search;
      },

      initFromUrl: () => {
        const p = new URLSearchParams(window.location.search);
        const patch: Partial<IntelFilter> = {};
        if (p.has("person")) patch.person = p.get("person") ?? null;
        const tr = p.get("timeRange");
        if (tr && (["1d", "7d", "14d", "30d"] as string[]).includes(tr)) {
          patch.timeRange = tr as TimeRange;
        }
        const rawSources = p.get("sources");
        if (rawSources) {
          const sources = rawSources
            .split(",")
            .filter((s): s is Source => s === "github" || s === "jira");
          if (sources.length) patch.sources = sources;
        }
        if (Object.keys(patch).length) {
          set((state) => ({ filter: { ...state.filter, ...patch } }));
        }
      },
    }),
    {
      name: "intel-filter",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ filter: state.filter }),
    }
  )
);
