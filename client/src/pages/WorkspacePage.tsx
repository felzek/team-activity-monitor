import { useState, useCallback, useEffect } from "react";
import { HistorySidebar } from "@/components/chat/HistorySidebar";
import { ChatPane } from "@/components/chat/ChatPane";
import { useSession } from "@/hooks/useSession";
import { useChatStore } from "@/store/chatStore";
import { useSessionStore } from "@/store/sessionStore";

const REQUIRED_PROVIDERS = ["github", "jira"] as const;

const PROVIDER_LABELS: Record<(typeof REQUIRED_PROVIDERS)[number], string> = {
  github: "GitHub",
  jira: "Jira",
};

function WorkspaceConnectionBanner() {
  const { data } = useSession();
  const missingProviders = REQUIRED_PROVIDERS.filter((provider) =>
    data?.providerAuth?.missingProviders?.includes(provider)
  );

  if (!data?.authenticated || missingProviders.length === 0) {
    return null;
  }

  return (
    <div className="workspace-connection-banner">
      <div className="workspace-connection-copy">
        <span className="workspace-connection-eyebrow">Workspace connections required</span>
        <h2 className="workspace-connection-title">
          Connect GitHub and Jira to ground Team Assist in your live team activity.
        </h2>
        <p className="workspace-connection-description">
          Team Assist uses both providers to answer with real pull requests, issues, and work-in-progress context. Connect the missing accounts here, then continue in chat.
        </p>
        <div className="workspace-connection-statuses">
          {REQUIRED_PROVIDERS.map((provider) => {
            const missing = missingProviders.includes(provider);
            return (
              <span
                key={provider}
                className={`workspace-connection-pill${missing ? " workspace-connection-pill--missing" : ""}`}
              >
                {PROVIDER_LABELS[provider]} {missing ? "required" : "connected"}
              </span>
            );
          })}
        </div>
      </div>
      <div className="workspace-connection-actions">
        {missingProviders.map((provider) => (
          <a
            key={provider}
            className="workspace-connection-action workspace-connection-action--primary"
            href={`/api/v1/auth/providers/${provider}/start?returnTo=${encodeURIComponent("/app")}`}
          >
            Connect {PROVIDER_LABELS[provider]}
          </a>
        ))}
        <a className="workspace-connection-action workspace-connection-action--secondary" href="/settings">
          Open settings
        </a>
      </div>
    </div>
  );
}

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
        <WorkspaceConnectionBanner />
        <ChatPane
          conversationId={activeConversationId}
          seedText={seedText}
          onSeedConsumed={() => setSeedText(undefined)}
        />
      </div>
    </div>
  );
}
