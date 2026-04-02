import { useState, useCallback, useEffect, useRef } from "react";
import { MessageList, type DisplayMessage } from "./MessageList";
import { ChatInput } from "./ChatInput";
import {
  ChatWelcomeState,
  type ArtifactQuickAction,
} from "./ChatWelcomeState";
import { useChatTurn } from "@/hooks/useChatTurn";
import { useModels } from "@/hooks/useModels";
import { useChatStore } from "@/store/chatStore";
import { useSessionStore } from "@/store/sessionStore";
import { ApiError } from "@/api/client";
import type { ChatMessage, ChatTurnResult } from "@/api/types";

let nextId = 1;
const uid = () => String(nextId++);

interface Props {
  conversationId: string | null;
  seedText?: string;
  onSeedConsumed?: () => void;
}

export function ChatPane({ conversationId, seedText, onSeedConsumed }: Props) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [modelId, setModelId] = useState("");
  const [chatTitle, setChatTitle] = useState("New chat");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [selectedAction, setSelectedAction] = useState<ArtifactQuickAction | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const currentConvRef = useRef<string | null>(null);

  const { data: models } = useModels();
  const authenticated = useSessionStore((state) => state.authenticated);
  const guestAccess = useSessionStore((state) => state.guestAccess);
  const setGuestAccess = useSessionStore((state) => state.setGuestAccess);
  const openAuthModal = useSessionStore((state) => state.openAuthModal);
  const chatTurn = useChatTurn();
  const loadMessages = useChatStore((s) => s.loadMessages);
  const conversations = useChatStore((s) => s.conversations);
  const updateConversation = useChatStore((s) => s.updateConversation);
  const createConversation = useChatStore((s) => s.createConversation);
  const loadConversations = useChatStore((s) => s.loadConversations);

  // Set default model once models load
  useEffect(() => {
    if (models && models.length > 0 && !modelId) {
      const toolModels = models.filter((m) => m.supportsTools);
      setModelId((toolModels[0] ?? models[0]).id);
    }
  }, [models, modelId]);

  // Consume seeded text from Intelligence pane
  useEffect(() => {
    if (seedText) {
      setInput(seedText);
      setSelectedAction(null);
      setFocusToken((token) => token + 1);
      onSeedConsumed?.();
    }
  }, [seedText, onSeedConsumed]);

  // Load messages when conversation changes
  useEffect(() => {
    if (conversationId === currentConvRef.current) return;
    currentConvRef.current = conversationId;

    if (!conversationId) {
      setMessages([]);
      setHistory([]);
      setChatTitle("New chat");
      setSelectedAction(null);
      return;
    }

    const conv = conversations.find((c) => c.id === conversationId);
    if (conv) setChatTitle(conv.title);

    setLoadingMessages(true);
    loadMessages(conversationId)
      .then((data) => {
        const displayMsgs: DisplayMessage[] = [];
        const historyMsgs: ChatMessage[] = [];

        for (const m of data.messages) {
          if (m.role === "user") {
            displayMsgs.push({ id: m.id, role: "user", content: m.content });
            historyMsgs.push({ role: "user", content: m.content });
          } else if (m.role === "assistant") {
            const meta = m.metadata as Record<string, unknown> | null;
            displayMsgs.push({
              id: m.id,
              role: "assistant",
              result: {
                answer: m.content,
                toolsUsed: (meta?.toolsUsed as string[]) ?? [],
                tokenUsage: (meta?.tokenUsage as { input: number; output: number }) ?? null,
                totalLatencyMs: (meta?.totalLatencyMs as number) ?? 0,
                partialFailures: [],
                sources: (meta?.sources as Array<{ source: string; freshness: "live" | "cached" }>) ?? [],
                artifactSuggestions: (meta?.artifactSuggestions as ChatTurnResult["artifactSuggestions"]) ?? [],
              },
            });
            historyMsgs.push({ role: "assistant", content: m.content });
          }
        }

        setMessages(displayMsgs);
        setHistory(historyMsgs);
        setSelectedAction(null);
      })
      .catch(() => {
        setMessages([]);
        setHistory([]);
        setSelectedAction(null);
      })
      .finally(() => setLoadingMessages(false));
  }, [conversationId, conversations, loadMessages]);

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
  }, []);

  const handleActionSelect = useCallback((action: ArtifactQuickAction) => {
    setSelectedAction(action);
    setInput(action.prompt);
    setFocusToken((token) => token + 1);
  }, []);

  const handleSuggestionSelect = useCallback((text: string) => {
    setSelectedAction(null);
    setInput(text);
    setFocusToken((token) => token + 1);
  }, []);

  const handleClearIntent = useCallback(() => {
    setSelectedAction(null);
    setFocusToken((token) => token + 1);
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || chatTurn.isPending) return;
    if (!authenticated && guestAccess?.authRequired) {
      openAuthModal("login");
      return;
    }
    const pendingAction = selectedAction;

    setInput("");
    setSelectedAction(null);

    // Auto-create conversation if none is active
    let activeId = conversationId;
    if (authenticated && !activeId) {
      try {
        const title = text.length > 50 ? text.slice(0, 50) + "..." : text;
        const conv = await createConversation({ title });
        activeId = conv.id;
        currentConvRef.current = activeId;
        setChatTitle(title);
      } catch {
        return;
      }
    } else if (authenticated && messages.length === 0 && activeId) {
      // First message in an existing empty conversation — set the title
      const title = text.length > 50 ? text.slice(0, 50) + "..." : text;
      setChatTitle(title);
      void updateConversation(activeId, { title });
    }

    const userMsgId = uid();
    const thinkingId = uid();

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: text },
      {
        id: thinkingId,
        role: "thinking",
        status: pendingAction
          ? {
              kind: "artifact",
              label: pendingAction.pendingTitle,
              detail: pendingAction.pendingDescription,
            }
          : undefined,
      },
    ]);

    const newHistory: ChatMessage[] = [...history, { role: "user", content: text }];
    setHistory(newHistory);

    chatTurn.mutate(
      { message: text, modelId, conversationId: activeId ?? undefined, history },
      {
        onSuccess: (result) => {
          if (result.guestAccess) {
            setGuestAccess(result.guestAccess);
            if (!authenticated && result.guestAccess.authRequired) {
              openAuthModal("login");
            }
          }
          setMessages((prev) =>
            prev
              .filter((m) => m.id !== thinkingId)
              .concat({ id: uid(), role: "assistant", result })
          );
          setHistory((h) => [...h, { role: "assistant", content: result.answer }]);
          if (authenticated) {
            void loadConversations();
          }
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === "GUEST_AUTH_REQUIRED") {
            const payload = err.payload as { guestAccess?: ChatTurnResult["guestAccess"] } | undefined;
            if (payload?.guestAccess) {
              setGuestAccess(payload.guestAccess);
            }
            openAuthModal("login");
          }
          setMessages((prev) =>
            prev
              .filter((m) => m.id !== thinkingId)
              .concat({
                id: uid(),
                role: "assistant",
                result: {
                  answer:
                    err instanceof ApiError && err.code === "GUEST_AUTH_REQUIRED"
                      ? "You’ve reached the 5-prompt guest limit. Sign in to continue this thread."
                      : `Error: ${err.message}`,
                  toolsUsed: [],
                  tokenUsage: null,
                  totalLatencyMs: 0,
                  partialFailures: [],
                },
              })
          );
        },
      }
    );
  }, [
    authenticated,
    conversationId,
    createConversation,
    chatTurn,
    guestAccess,
    history,
    input,
    loadConversations,
    messages.length,
    modelId,
    openAuthModal,
    selectedAction,
    setGuestAccess,
    updateConversation,
  ]);

  const showWelcomeState = !loadingMessages && messages.length === 0;
  const guestLimitReached = !authenticated && Boolean(guestAccess?.authRequired);
  const guestHelperText = guestLimitReached
    ? "You’ve used all 5 guest prompts. Sign in to continue in this workspace."
    : !authenticated && guestAccess
      ? `${guestAccess.promptsRemaining} of ${guestAccess.promptLimit} guest prompts left before sign-in is required.`
      : "Grounded in your connected workspace data.";

  return (
    <div className="chat-pane">
      <div className={`chat-pane-header${showWelcomeState ? " chat-pane-header--empty" : ""}`}>
        <span className="chat-pane-title">{chatTitle}</span>
        {!authenticated && guestAccess && (
          <span className={`chat-guest-pill${guestLimitReached ? " is-exhausted" : ""}`}>
            {guestLimitReached
              ? "Sign in to continue"
              : `${guestAccess.promptsRemaining} prompts left`}
          </span>
        )}
      </div>

      {loadingMessages ? (
        <div className="message-list" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span className="muted" style={{ fontSize: "0.82rem" }}>Loading messages...</span>
        </div>
      ) : showWelcomeState ? (
        <ChatWelcomeState
          value={input}
          onChange={handleInputChange}
          onSubmit={sendMessage}
          disabled={chatTurn.isPending || loadingMessages || guestLimitReached}
          modelId={modelId}
          onModelChange={setModelId}
          selectedAction={selectedAction}
          onActionSelect={handleActionSelect}
          onSuggestionSelect={handleSuggestionSelect}
          onClearIntent={handleClearIntent}
          focusToken={focusToken}
          helperText={guestHelperText}
        />
      ) : (
        <MessageList
          messages={messages}
        />
      )}

      {!showWelcomeState && (
        <ChatInput
          value={input}
          onChange={handleInputChange}
          onSubmit={sendMessage}
          disabled={chatTurn.isPending || loadingMessages || guestLimitReached}
          modelId={modelId}
          onModelChange={setModelId}
          intentLabel={selectedAction ? `Creating: ${selectedAction.label}` : null}
          onClearIntent={handleClearIntent}
          focusToken={focusToken}
          helperText={guestHelperText}
        />
      )}
    </div>
  );
}
