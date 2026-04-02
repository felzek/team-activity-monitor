import { useState, useCallback } from "react";
import { HistorySidebar } from "@/components/chat/HistorySidebar";
import { ChatPane } from "@/components/chat/ChatPane";
import { useChatStore } from "@/store/chatStore";
import { useSessionStore } from "@/store/sessionStore";

export function WorkspacePage() {
  const [seedText, setSeedText] = useState<string | undefined>();
  const authenticated = useSessionStore((state) => state.authenticated);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const createConversation = useChatStore((s) => s.createConversation);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);

  const handleNewChat = useCallback(async () => {
    const conv = await createConversation();
    setActiveConversation(conv.id);
  }, [createConversation, setActiveConversation]);

  return (
    <div className={`workspace-layout${authenticated ? "" : " workspace-layout--guest"}`}>
      {authenticated && <HistorySidebar onNewChat={() => void handleNewChat()} />}
      <div className={`workspace-main${authenticated ? "" : " workspace-main--guest"}`}>
        <ChatPane
          conversationId={activeConversationId}
          seedText={seedText}
          onSeedConsumed={() => setSeedText(undefined)}
        />
      </div>
    </div>
  );
}
