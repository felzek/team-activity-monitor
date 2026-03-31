import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import { useIntelStore } from "@/store/intelStore";
import type { IntelligenceBoard } from "@/api/types";

export function useIntelBoard(orgId: string | null) {
  const filter = useIntelStore((s) => s.filter);

  return useQuery({
    queryKey: ["intel-board", orgId, filter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (filter.person) p.set("person", filter.person);
      p.set("timeRange", filter.timeRange);
      p.set("sources", filter.sources.join(","));
      return apiFetch<IntelligenceBoard>(
        `/api/v1/orgs/${orgId}/intelligence/board?${p}`
      );
    },
    enabled: !!orgId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
