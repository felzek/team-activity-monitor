import { useState, useCallback, useEffect } from "react";
import { HistorySidebar } from "@/components/chat/HistorySidebar";
import { ChatPane } from "@/components/chat/ChatPane";
import { useChatStore } from "@/store/chatStore";
import { useSessionStore } from "@/store/sessionStore";

export function WorkspacePage() {
  const [seedText, setSeedText] = useState<string | undefined>();
  const authenticated = useSessionStore((state) => state.authenticated);
  const openAuthModal = useSessionStore((state) => state.openAuthModal);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const createConversation = useChatStore((s) => s.createConversation);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);

  useEffect(() => {
    if (!authenticated) {
      if (activeConversationId) {
        setActiveConversation(null);
      }
      if (!sidebarOpen) {
        setSidebarOpen(true);
      }
    }
  }, [activeConversationId, authenticated, setActiveConversation, setSidebarOpen, sidebarOpen]);

  const handleNewChat = useCallback(async () => {
    if (!authenticated) {
      openAuthModal("login");
      return;
    }
    const conv = await createConversation();
    setActiveConversation(conv.id);
  }, [authenticated, createConversation, openAuthModal, setActiveConversation]);

  const handleRequireAuth = useCallback(() => {
    openAuthModal("login");
  }, [openAuthModal]);

  return (
    <div className="workspace-layout">
      <HistorySidebar
        onNewChat={() => void handleNewChat()}
        guestMode={!authenticated}
        onRequireAuth={handleRequireAuth}
      />
      <div className="workspace-main">
        <ChatPane
          conversationId={activeConversationId}
          seedText={seedText}
          onSeedConsumed={() => setSeedText(undefined)}
        />
      </div>
    </div>
  );
}
