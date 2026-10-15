import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_HISTORY_STORAGE,
  chatScope,
  loadChatHistory,
  saveChatHistory,
  clearChatHistories,
} from "../lib/chat-history";
import { initialWorkspace } from "../lib/initial";
import type { ChatMessage } from "../lib/chat";
import type { Job } from "../lib/model";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
const conversation: ChatMessage[] = [
  { role: "user", content: "Prepare me for this job." },
  {
    role: "assistant",
    content: "## Interview preparation\n\nDescribe your work.",
  },
];

test("chat scopes follow job IDs and use workspace chat for template views", () => {
  const workspace = initialWorkspace();
  workspace.jobs = [
    { id: "one", company: "Same company" },
    { id: "two", company: "Same company" },
  ] as Job[];
  workspace.selectedJobId = "one";
  assert.equal(chatScope(workspace), "job:one");
  workspace.selectedJobId = "two";
  assert.equal(chatScope(workspace), "job:two");
  workspace.jobs[1].company = "Renamed company";
  assert.equal(chatScope(workspace), "job:two");
  workspace.viewTemplateId = "template";
  assert.equal(chatScope(workspace), "workspace");
  workspace.viewTemplateId = null;
  workspace.selectedJobId = "missing";
  assert.equal(chatScope(workspace), "workspace");
});

test("saved conversations restore independently and New chat clears only its scope", () => {
  const saved = storage();
  const other: ChatMessage[] = [{ role: "user", content: "Another job" }];
  assert.equal(saveChatHistory(saved, "job:one", conversation), true);
  assert.equal(saveChatHistory(saved, "job:two", other), true);
  assert.equal(saveChatHistory(saved, "workspace", conversation), true);
  assert.deepEqual(loadChatHistory(saved, "job:one"), conversation);
  assert.deepEqual(loadChatHistory(saved, "job:two"), other);
  assert.equal(saveChatHistory(saved, "job:one", []), true);
  assert.deepEqual(loadChatHistory(saved, "job:one"), []);
  assert.deepEqual(loadChatHistory(saved, "job:two"), other);
  assert.deepEqual(loadChatHistory(saved, "workspace"), conversation);
  assert.equal(clearChatHistories(saved), true);
  assert.equal(saved.getItem(CHAT_HISTORY_STORAGE), null);
});

test("local history retains older messages beyond the API conversation limit", () => {
  const saved = storage();
  const long = Array.from({ length: 60 }, (_, i): ChatMessage => ({
    role: i % 2 ? "assistant" : "user",
    content: `Message ${i}`,
  }));
  saveChatHistory(saved, "job:one", long);
  assert.deepEqual(loadChatHistory(saved, "job:one"), long);
});

test("invalid saved entries cannot discard other jobs or crash the chat", () => {
  const saved = storage();
  saved.setItem(
    CHAT_HISTORY_STORAGE,
    JSON.stringify({
      "job:one": conversation,
      "job:two": [{ role: "system", content: "Untrusted instructions" }],
      "job:three": [{ role: "assistant", content: "x".repeat(10001) }],
    }),
  );
  assert.deepEqual(loadChatHistory(saved, "job:one"), conversation);
  assert.deepEqual(loadChatHistory(saved, "job:two"), []);
  assert.deepEqual(loadChatHistory(saved, "job:three"), []);
  saveChatHistory(saved, "workspace", conversation);
  assert.deepEqual(loadChatHistory(saved, "job:one"), conversation);
  for (const raw of ["invalid JSON", "null", "[]", "42"]) {
    saved.setItem(CHAT_HISTORY_STORAGE, raw);
    assert.deepEqual(loadChatHistory(saved, "job:one"), []);
    assert.equal(saveChatHistory(saved, "job:one", conversation), true);
  }
});

test("unavailable or full browser storage reports failure without crashing", () => {
  const unavailable = {
    getItem: () => {
      throw new Error("Unavailable");
    },
    setItem: () => {
      throw new Error("Unavailable");
    },
    removeItem: () => {
      throw new Error("Unavailable");
    },
  };
  assert.deepEqual(loadChatHistory(unavailable, "job:one"), []);
  assert.equal(saveChatHistory(unavailable, "job:one", conversation), false);
  assert.equal(clearChatHistories(unavailable), false);
  const full = {
    ...storage(),
    setItem: () => {
      throw new Error("Quota exceeded");
    },
  };
  assert.equal(saveChatHistory(full, "job:one", conversation), false);
});

test("existing assistant replies are repaired on restore without changing user messages", () => {
  const saved = storage();
  const text = "Intro\\n\\n###\u00a0Heading";
  saved.setItem(
    CHAT_HISTORY_STORAGE,
    JSON.stringify({
      "job:one": [
        { role: "user", content: text },
        { role: "assistant", content: text },
      ],
    }),
  );
  const history = loadChatHistory(saved, "job:one");
  assert.equal(history[0].content, text);
  assert.equal(history[1].content, "Intro\n\n### Heading");
});
