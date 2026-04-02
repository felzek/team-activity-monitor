import type { ConversationEntry, ProjectEntry } from "@/api/types";

const PREVIEW_ORG_ID = "guest-preview-org";
const PREVIEW_USER_ID = "guest-preview-user";

function buildConversation(
  id: string,
  title: string,
  preview: string,
  updatedAt: string,
  options?: { pinned?: boolean; projectId?: string | null; messageCount?: number }
): ConversationEntry {
  return {
    id,
    organizationId: PREVIEW_ORG_ID,
    userId: PREVIEW_USER_ID,
    projectId: options?.projectId ?? null,
    title,
    pinned: options?.pinned ?? false,
    archivedAt: null,
    messageCount: options?.messageCount ?? 6,
    lastMessagePreview: preview,
    lastMessageAt: updatedAt,
    createdAt: updatedAt,
    updatedAt,
  };
}

export const GUEST_PREVIEW_ACTIVE_ID = "guest-preview-weekly";

export const GUEST_PREVIEW_PROJECTS: ProjectEntry[] = [
  {
    id: "guest-project-launch",
    organizationId: PREVIEW_ORG_ID,
    name: "Launch review",
    description: "Mock workspace project for the guest preview.",
    instructions: null,
    icon: null,
    archivedAt: null,
    createdAt: "2026-03-29T12:00:00.000Z",
    updatedAt: "2026-04-01T13:20:00.000Z",
  },
];

export const GUEST_PREVIEW_CONVERSATIONS: ConversationEntry[] = [
  buildConversation(
    "guest-preview-weekly",
    "Weekly summary",
    "Sprint wins, blockers, and follow-ups from the sample workspace.",
    "2026-04-01T13:20:00.000Z",
    { pinned: true, messageCount: 9 }
  ),
  buildConversation(
    "guest-preview-blockers",
    "Sprint blockers",
    "Open Jira blockers with owners and linked pull requests.",
    "2026-04-01T11:05:00.000Z",
    { messageCount: 7 }
  ),
  buildConversation(
    "guest-preview-rollout",
    "Rollout check-in",
    "What shipped, what slipped, and the next risks to watch.",
    "2026-03-31T16:40:00.000Z",
    { messageCount: 8 }
  ),
  buildConversation(
    "guest-preview-launch-deck",
    "Launch deck draft",
    "A six-slide sprint review built from the sample workspace data.",
    "2026-03-30T14:15:00.000Z",
    { projectId: "guest-project-launch", messageCount: 5 }
  ),
  buildConversation(
    "guest-preview-ops",
    "Ops follow-ups",
    "Loose ends from support issues, deploys, and handoffs.",
    "2026-03-25T18:00:00.000Z",
    { messageCount: 4 }
  ),
];
