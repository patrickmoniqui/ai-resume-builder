import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_SETTINGS_STORAGE,
  loadAISettings,
  saveAISettings,
} from "../lib/ai-settings";
import type { AIConnection } from "../lib/model";
function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
test("the last successful API or subscription connection restores all settings", () => {
  const saved = storage();
  const connections: AIConnection[] = [
    {
      method: "apiKey",
      provider: "anthropic",
      model: "test-claude",
      key: "test-key",
    },
    { method: "subscription", provider: "openai", model: "" },
    { method: "subscription", provider: "anthropic", model: "sonnet" },
    {
      method: "apiKey",
      provider: "openai",
      model: "test-model",
      key: "test-api-key",
    },
  ];
  for (const connection of connections) {
    assert.equal(saveAISettings(saved, connection), true);
    assert.deepEqual(loadAISettings(saved), connection);
  }
  assert.equal(saveAISettings(saved, null), true);
  assert.equal(loadAISettings(saved), null);
  assert.equal(saved.getItem(AI_SETTINGS_STORAGE), null);
});
test("corrupt or unavailable settings cannot crash the workspace", () => {
  const saved = storage();
  saved.setItem(AI_SETTINGS_STORAGE, "bad JSON");
  assert.equal(loadAISettings(saved), null);
  saved.setItem(
    AI_SETTINGS_STORAGE,
    JSON.stringify({ method: "unknown", provider: "openai" }),
  );
  assert.equal(loadAISettings(saved), null);
  const disabled = {
    getItem: () => {
      throw new Error("Disabled");
    },
    setItem: () => {
      throw new Error("Disabled");
    },
    removeItem: () => {
      throw new Error("Disabled");
    },
  };
  assert.equal(loadAISettings(disabled), null);
  assert.equal(
    saveAISettings(disabled, {
      method: "subscription",
      provider: "openai",
      model: "",
    }),
    false,
  );
});
