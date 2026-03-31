import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import { useIntelStore } from "@/store/intelStore";
import type { IntelligenceOverview } from "@/api/types";

export function useIntelOverview(orgId: string | null) {
  const filter = useIntelStore((s) => s.filter);

  return useQuery({
    queryKey: ["intel-overview", orgId, filter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (filter.person) p.set("person", filter.person);
      p.set("timeRange", filter.timeRange);
      p.set("sources", filter.sources.join(","));
      return apiFetch<IntelligenceOverview>(
        `/api/v1/orgs/${orgId}/intelligence/overview?${p}`
      );
    },
    enabled: !!orgId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
