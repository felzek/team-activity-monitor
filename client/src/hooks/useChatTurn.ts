import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import type { ChatTurnRequest, ChatTurnResult } from "@/api/types";

export function useChatTurn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: ChatTurnRequest) =>
      apiFetch<ChatTurnResult>("/api/v1/chat", {
        method: "POST",
        body: JSON.stringify(req),
      }),
    onSuccess: () => {
      // Invalidate intel queries so the board refreshes after a chat query
      void queryClient.invalidateQueries({ queryKey: ["intel-overview"] });
      void queryClient.invalidateQueries({ queryKey: ["intel-board"] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void queryClient.invalidateQueries({ queryKey: ["llm-models"] });
    },
  });
}
