import { z } from "zod";
import { chatMessageSchema, type ChatMessage } from "./chat";
import type { Workspace } from "./model";

export const CHAT_HISTORY_STORAGE = "resume-builder.chat-history.v1";
type ChatStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const historySchema = z.array(chatMessageSchema);

export function chatScope(workspace: Workspace) {
  const job =
    !workspace.viewTemplateId &&
    workspace.jobs.find((job) => job.id === workspace.selectedJobId);
  return job ? `job:${job.id}` : "workspace";
}

function readHistories(storage: ChatStorage): Record<string, ChatMessage[]> {
  const raw = storage.getItem(CHAT_HISTORY_STORAGE);
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const histories: Record<string, ChatMessage[]> = Object.create(null);
  for (const [scope, value] of Object.entries(data)) {
    if (scope !== "workspace" && !scope.startsWith("job:")) continue;
    const result = historySchema.safeParse(value);
    if (result.success) histories[scope] = result.data;
  }
  return histories;
}

export function loadChatHistory(
  storage: ChatStorage,
  scope: string,
): ChatMessage[] {
  try {
    return readHistories(storage)[scope] || [];
  } catch {
    return [];
  }
}

export function saveChatHistory(
  storage: ChatStorage,
  scope: string,
  messages: ChatMessage[],
) {
  try {
    const histories = readHistories(storage);
    if (messages.length) histories[scope] = historySchema.parse(messages);
    else delete histories[scope];
    if (Object.keys(histories).length)
      storage.setItem(CHAT_HISTORY_STORAGE, JSON.stringify(histories));
    else storage.removeItem(CHAT_HISTORY_STORAGE);
    return true;
  } catch {
    return false;
  }
}

export function clearChatHistories(storage: ChatStorage) {
  try {
    storage.removeItem(CHAT_HISTORY_STORAGE);
    return true;
  } catch {
    return false;
  }
}
