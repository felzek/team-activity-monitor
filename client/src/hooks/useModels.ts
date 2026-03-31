import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import type { LlmModel } from "@/api/types";

interface ModelsResponse {
  models: LlmModel[];
}

export function useModels() {
  return useQuery({
    queryKey: ["llm-models"],
    queryFn: () => apiFetch<ModelsResponse>("/api/llm/models"),
    staleTime: 60 * 1000,
    select: (data) => data.models,
  });
}
