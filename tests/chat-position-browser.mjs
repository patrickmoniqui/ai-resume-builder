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
await page.addInitScript(() => {
  localStorage.setItem(
    "resume-builder.ai-connection.v1",
    JSON.stringify({
      method: "apiKey",
      provider: "anthropic",
      model: "test-claude",
      key: "test-key",
    }),
  );
  // A previous floating position must not affect the docked layout.
  localStorage.setItem(
    "resume-builder.chat-position.v1",
    JSON.stringify({ x: 12, y: 12 }),
  );
});
await page.route("**/api/chat", (route) =>
  route.fulfill({ json: { reply: "Saved docked reply" } }),
);
const panel = page.locator(".chat-panel");
const tools = page.getByRole("complementary", { name: "Right tools" });
const chatTab = page.getByRole("tab", { name: "AI chat" });
const matchTab = page.getByRole("tab", { name: "Resume match" });
const trigger = page.getByRole("button", { name: "AI chatbot", exact: true });
const toggle = page.getByRole("button", { name: "Toggle right tools panel" });
const ready = () =>
  page.getByText("Saved on this device", { exact: true }).waitFor();
const docked = async (mobile = false) => {
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  const side = await tools.boundingBox();
  const center = await page.locator(".center-panel").boundingBox();
  assert.ok(Math.abs(box.x - side.x - 1) < 1);
  assert.ok(Math.abs(box.x + box.width - side.x - side.width) < 1);
  assert.ok(Math.abs(box.y + box.height - side.y - side.height) < 1);
  if (!mobile) assert.ok(box.x >= center.x + center.width);
  assert.equal(
    await panel.evaluate((el) => getComputedStyle(el).position),
    "static",
  );
  assert.equal(
    await panel.evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
};
try {
  await page.goto(process.env.TEST_BASE_URL || "http://localhost:3000");
  await ready();
  await expect(matchTab).toHaveAttribute("aria-selected", "true");
  await trigger.click();
  await expect(chatTab).toHaveAttribute("aria-selected", "true");
  await docked();
  assert.equal(await page.locator(".chat-launcher").count(), 0);
  const input = page.getByLabel("Message AI", { exact: true });
  await input.fill("Remember this draft");
  await matchTab.click();
  await expect(panel).toBeHidden();
  await expect(
    page.getByRole("tabpanel", { name: "Resume match" }),
  ).toBeVisible();
  await chatTab.click();
  await expect(input).toHaveValue("Remember this draft");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByText("Saved docked reply", { exact: true }).waitFor();
  await input.fill("Still drafting");
  await toggle.click();
  await expect(tools).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Expand right tools" }).click();
  await expect(input).toHaveValue("Still drafting");
  await expect(page.locator(".chat-message")).toHaveCount(2);
  await toggle.click();
  await trigger.click();
  await docked();
  await expect(input).toHaveValue("Still drafting");
  const resize = page.getByRole("separator", {
    name: "Resize right tools panel",
  });
  await resize.focus();
  await resize.press("End");
  await docked();
  await resize.press("Home");
  await docked();
  await page.getByRole("button", { name: "Instructions", exact: true }).click();
  await page
    .getByLabel("Chat instructions / system prompt")
    .fill("Keep it brief.");
  await docked();
  await page.getByRole("button", { name: "Back to chat" }).click();
  await resize.dblclick();
  await matchTab.click();
  await matchTab.press("ArrowRight");
  await expect(chatTab).toBeFocused();
  await expect(chatTab).toHaveAttribute("aria-selected", "true");
  await chatTab.press("Home");
  await expect(matchTab).toBeFocused();
  await matchTab.press("End");
  await expect(chatTab).toBeFocused();
  await page.screenshot({ path: "test-results/chat-docked-desktop.png" });
  await input.press("Escape");
  await expect(matchTab).toHaveAttribute("aria-selected", "true");
  await expect(trigger).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Expand right tools" }),
  ).toBeVisible();
  await expect(tools).toBeHidden();
  await trigger.click();
  await docked(true);
  await expect(page.locator(".chat-message")).toHaveCount(2);
  await input.fill("Mobile draft");
  await matchTab.click();
  await chatTab.click();
  await expect(input).toHaveValue("Mobile draft");
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeInViewport();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({ path: "test-results/chat-docked-mobile.png" });
  await page.getByRole("button", { name: "Close AI chatbot" }).click();
  await expect(matchTab).toHaveAttribute("aria-selected", "true");
  assert.deepEqual(errors, []);
  console.log(
    "Chat docking checks passed: right placement, tabs, drafts, history, collapse/reopen, resizing, instructions, keyboard navigation, and mobile drawer.",
  );
} finally {
  await browser.close();
}
