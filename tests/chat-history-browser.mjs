import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";

const browser = await chromium.launch({
  executablePath:
    process.env.BROWSER_EXECUTABLE_PATH ||
    (process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined),
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const historyKey = "resume-builder.chat-history.v1";
const connectionKey = "resume-builder.ai-connection.v1";
const workspaceKey = "resume-builder.workspace.v1";
await page.addInitScript(
  ({ connectionKey, workspaceKey }) => {
    if (localStorage.getItem(workspaceKey)) return;
    localStorage.setItem(
      workspaceKey,
      JSON.stringify({
        templates: [],
        docs: {},
        notes: [],
        references: [],
        selectedJobId: "first",
        viewTemplateId: null,
        jobs: ["first", "second"].map((id) => ({
          id,
          company: `${id} employer`,
          title: "Engineer",
          templateId: "",
          location: "Remote",
          source: "Pasted",
          rawDescription: "Build React applications.",
          keywords: [{ term: "React", category: "Tools", required: true }],
        })),
      }),
    );
    localStorage.setItem(
      connectionKey,
      JSON.stringify({
        method: "apiKey",
        provider: "anthropic",
        model: "test-claude",
        key: "test-key",
      }),
    );
  },
  { connectionKey, workspaceKey },
);

let pendingRoute;
let pendingStarted;
const pending = new Promise((resolve) => {
  pendingStarted = resolve;
});
let latestBody;
await page.route("**/api/chat", async (route) => {
  const body = route.request().postDataJSON();
  latestBody = body;
  if (body.messages.at(-1).content === "Wait for reply") {
    pendingRoute = route;
    pendingStarted();
    return;
  }
  await route.fulfill({
    json: {
      reply: `Reply for ${body.workspace.selectedJobId}\\n\\n###\u00a0Saved advice\\n\\nUse **evidence**.`,
    },
  });
});
const messages = page.locator(".chat-message");
const select = (id) =>
  page
    .locator(".job-card")
    .filter({ hasText: `${id} employer` })
    .click();
const open = () =>
  page.getByRole("button", { name: "AI chatbot", exact: true }).click();
const send = async (text) => {
  await page.getByLabel("Message AI", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
};
const ready = () =>
  page.getByText("Saved on this device", { exact: true }).waitFor();
const stored = () =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)), historyKey);
try {
  await page.goto(process.env.TEST_BASE_URL || "http://localhost:3000");
  await ready();
  await open();
  await send("First job question");
  await page.getByText("Reply for first", { exact: true }).waitFor();
  await expect(page.locator(".chat-reply h3")).toHaveText("Saved advice");
  assert.equal(
    (await page.locator(".chat-reply").innerText()).includes("\\n"),
    false,
  );
  await select("second");
  await expect(messages).toHaveCount(0);
  await send("Second job question");
  await page.getByText("Reply for second", { exact: true }).waitFor();
  assert.equal(latestBody.messages.length, 1);
  await select("first");
  await expect(messages).toHaveCount(2);
  assert.ok(
    (await messages.first().innerText()).includes("First job question"),
  );
  // Reproduce a reply saved before the formatting repair was introduced.
  await page.evaluate((key) => {
    const histories = JSON.parse(localStorage.getItem(key));
    histories["job:first"][1].content =
      "Reply for first\\n\\n###\u00a0Saved advice\\n\\nUse **evidence**.";
    localStorage.setItem(key, JSON.stringify(histories));
  }, historyKey);
  await page.reload();
  await ready();
  await open();
  await expect(messages).toHaveCount(2);
  await expect(page.locator(".chat-reply h3")).toHaveText("Saved advice");
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (text) => {
      window.chatCopiedText = text;
    };
  });
  await page.getByRole("button", { name: "Copy reply 2", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.chatCopiedText),
    "Reply for first\n\n### Saved advice\n\nUse **evidence**.",
  );
  await page.evaluate((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        method: "apiKey",
        provider: "openai",
        model: "test-openai",
        key: "test-key",
      }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key }));
  }, connectionKey);
  await page
    .locator(".chat-header")
    .getByText("OpenAI · API", { exact: true })
    .waitFor();
  await expect(messages).toHaveCount(2);
  await send("Wait for reply");
  await pending;
  await select("second");
  await expect(messages).toHaveCount(2);
  await pendingRoute
    .fulfill({ json: { reply: "Late reply from first job" } })
    .catch(() => {});
  assert.equal(
    await page.getByText("Late reply from first job", { exact: true }).count(),
    0,
  );
  assert.equal((await stored())["job:first"].length, 2);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(messages).toHaveCount(0);
  assert.equal((await stored())["job:second"], undefined);
  await select("first");
  await expect(messages).toHaveCount(2);
  await select("second");
  await page.reload();
  await ready();
  await open();
  await expect(messages).toHaveCount(0);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new Error("Quota exceeded");
      return original.call(this, name, value);
    };
  }, historyKey);
  await send("Unsaved question");
  await page.getByText("Reply for second", { exact: true }).waitFor();
  await page
    .getByRole("status")
    .filter({ hasText: "Chat changes could not be saved" })
    .waitFor();
  assert.equal((await stored())["job:second"], undefined);
  await page.reload();
  await ready();
  await open();
  await expect(messages).toHaveCount(0);
  await page.evaluate((key) => {
    const histories = JSON.parse(localStorage.getItem(key));
    histories["job:second"] = Array.from({ length: 24 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: `Historical message ${i}`,
    }));
    localStorage.setItem(key, JSON.stringify(histories));
  }, historyKey);
  await page.reload();
  await ready();
  await open();
  await expect(messages).toHaveCount(24);
  await send("Continue the long conversation");
  await page.getByText("Reply for second", { exact: true }).waitFor();
  assert.equal(latestBody.messages.length, 19);
  await expect(messages).toHaveCount(26);
  assert.equal((await stored())["job:second"].length, 26);
  await page
    .getByRole("button", { name: "Close AI chatbot", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Import resume", exact: true })
    .click();
  await page.getByRole("button", { name: "Start fresh", exact: true }).click();
  await page
    .getByRole("button", { name: "Clear workspace", exact: true })
    .click();
  assert.equal(await stored(), null);
  await open();
  await expect(messages).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    "Chat history browser checks passed: separate jobs, refresh, connection changes, canceled replies, scoped clearing, storage failures, long history, and workspace reset.",
  );
} finally {
  await browser.close();
}
