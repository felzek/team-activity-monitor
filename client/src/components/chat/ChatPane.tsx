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
    const pendingAction = selectedAction;

    setInput("");
    setSelectedAction(null);

    // Auto-create conversation if none is active
    let activeId = conversationId;
    if (!activeId) {
      try {
        const title = text.length > 50 ? text.slice(0, 50) + "..." : text;
        const conv = await createConversation({ title });
        activeId = conv.id;
        currentConvRef.current = activeId;
        setChatTitle(title);
      } catch {
        return;
      }
    } else if (messages.length === 0) {
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
      { message: text, modelId, conversationId: activeId, history },
      {
        onSuccess: (result) => {
          setMessages((prev) =>
            prev
              .filter((m) => m.id !== thinkingId)
              .concat({ id: uid(), role: "assistant", result })
          );
          setHistory((h) => [...h, { role: "assistant", content: result.answer }]);
          void loadConversations();
        },
        onError: (err) => {
          setMessages((prev) =>
            prev
              .filter((m) => m.id !== thinkingId)
              .concat({
                id: uid(),
                role: "assistant",
                result: {
                  answer: `Error: ${err.message}`,
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
  }, [input, chatTurn, history, modelId, messages.length, conversationId, updateConversation, createConversation, loadConversations, selectedAction]);

  const showWelcomeState = !loadingMessages && messages.length === 0;

  return (
    <div className="chat-pane">
      <div className={`chat-pane-header${showWelcomeState ? " chat-pane-header--empty" : ""}`}>
        <span className="chat-pane-title">{chatTitle}</span>
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
          disabled={chatTurn.isPending || loadingMessages}
          modelId={modelId}
          onModelChange={setModelId}
          selectedAction={selectedAction}
          onActionSelect={handleActionSelect}
          onSuggestionSelect={handleSuggestionSelect}
          onClearIntent={handleClearIntent}
          focusToken={focusToken}
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
          disabled={chatTurn.isPending || loadingMessages}
          modelId={modelId}
          onModelChange={setModelId}
          intentLabel={selectedAction ? `Creating: ${selectedAction.label}` : null}
          onClearIntent={handleClearIntent}
          focusToken={focusToken}
        />
      )}
    </div>
  );
}
