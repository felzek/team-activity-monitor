import { useEffect, useRef } from "react";
import { UserMessage, AssistantMessage, ThinkingMessage } from "./MessageItem";
import type { ChatMessage, ChatTurnResult } from "@/api/types";

export interface ThinkingStatus {
  kind?: "artifact";
  label?: string;
  detail?: string;
}

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "thinking";
  content?: string;
  result?: ChatTurnResult;
  status?: ThinkingStatus;
}

interface Props {
  messages: DisplayMessage[];
  guestLocked?: boolean;
  onLockedInteraction?: () => void;
}

export function MessageList({ messages, guestLocked = false, onLockedInteraction }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return <div className="message-list" />;
  }

  return (
    <div className="message-list">
      {messages.map((m) => {
        if (m.role === "user") {
          return <UserMessage key={m.id} message={{ role: "user", content: m.content! }} />;
        }
        if (m.role === "thinking") {
          return <ThinkingMessage key={m.id} status={m.status} />;
        }
        return (
          <AssistantMessage
            key={m.id}
            result={m.result!}
            guestLocked={guestLocked}
            onLockedInteraction={onLockedInteraction}
          />
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
