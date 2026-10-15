import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { blankResume, initialWorkspace } from "../lib/initial.ts";
import { prepareChatChanges } from "../lib/chat-changes.ts";

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
const workspaceKey = "resume-builder.workspace.v1";
const initial = {
  ...initialWorkspace(),
  templates: [
    {
      id: "base",
      docId: "t:base",
      name: "Engineering",
      source: "Uploaded",
      sourceFile: "resume.pdf",
    },
  ],
  docs: {
    "t:base": {
      ...blankResume(),
      name: "Applicant",
      headline: "Engineer",
      summary: "Built React applications.",
      skills: "React",
      roles: [
        {
          company: "Acme",
          title: "Engineer",
          dates: "2020–2024",
          bullets: ["Built React applications."],
        },
      ],
    },
  },
  jobs: ["first", "second"].map((id) => ({
    id,
    templateId: "base",
    company: `${id} employer`,
    title: "Engineer",
    location: "Remote",
    source: "Pasted",
    rawDescription: "Build React apps",
    keywords: [{ term: "React", required: true, category: "Tools" }],
  })),
  notes: [
    {
      id: "note",
      text: "Created a React dashboard.",
      createdAt: "2026-10-05T00:00:00Z",
    },
  ],
  selectedJobId: "first",
};
await page.addInitScript(
  ({ workspaceKey, initial }) => {
    if (localStorage.getItem(workspaceKey)) return;
    localStorage.setItem(workspaceKey, JSON.stringify(initial));
    localStorage.setItem(
      "resume-builder.ai-connection.v1",
      JSON.stringify({
        method: "apiKey",
        provider: "anthropic",
        model: "test-claude",
        key: "test-key",
      }),
    );
  },
  { workspaceKey, initial },
);
await page.route("**/api/match", (route) =>
  route.fulfill({
    status: 429,
    json: { error: "Matching stubbed during chat test" },
  }),
);
let requests = 0;
await page.route("**/api/chat", (route) => {
  requests++;
  const { workspace } = route.request().postDataJSON();
  const template = workspace.viewTemplateId;
  return route.fulfill({
    json: {
      reply: "Review these suggested edits before applying them.",
      changes: prepareChatChanges(
        workspace,
        template
          ? [
              {
                field: "summary",
                before: "Built React applications.",
                after: "Edited template summary.",
                reason: "Clarify the template wording.",
              },
            ]
          : [
              {
                field: "summary",
                before: "Built React applications.",
                after:
                  "React engineer with application development experience.",
                reason: "Bring the documented React experience into focus.",
              },
              {
                field: "headline",
                before: "Engineer",
                after: "React Engineer",
                reason: "Use the documented technology.",
              },
              {
                field: "roles.0.bullets.1",
                before: "",
                after: "Created a React dashboard.",
                reason: "Use the achievement documented in your notes.",
              },
            ],
      ),
    },
  });
});
const open = () =>
  page.getByRole("button", { name: "AI chatbot", exact: true }).click();
const ready = () =>
  page.getByText("Saved on this device", { exact: true }).waitFor();
const stored = () =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)), workspaceKey);
const send = async () => {
  await page
    .getByLabel("Message AI", { exact: true })
    .fill("Suggest improvements with changes I can apply.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".chat-change")).not.toHaveCount(0);
};
try {
  await page.goto(process.env.TEST_BASE_URL || "http://localhost:3000");
  await ready();
  await open();
  await send();
  const summary = page.getByRole("region", {
    name: "Suggested change: Summary",
    exact: true,
  });
  const headline = page.getByRole("region", {
    name: "Suggested change: Headline",
    exact: true,
  });
  const bullet = page.getByRole("region", {
    name: "Suggested change: Acme · Bullet 2",
    exact: true,
  });
  await expect(summary.locator("del")).toHaveText("Built React applications.");
  await expect(summary.locator("ins")).toHaveText(
    "React engineer with application development experience.",
  );
  assert.equal((await stored()).jobs[0].tailoredDocId, undefined);
  await fs.mkdir("test-results", { recursive: true });
  await summary.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/chat-changes-desktop.png" });
  await summary
    .getByRole("button", { name: "Apply change", exact: true })
    .click();
  await expect(
    summary.getByRole("button", { name: "Applied", exact: true }),
  ).toBeDisabled();
  let saved = await stored();
  assert.equal(
    saved.docs["j:first"].summary,
    "React engineer with application development experience.",
  );
  assert.equal(saved.docs["t:base"].summary, "Built React applications.");
  assert.equal(saved.jobs[1].tailoredDocId, undefined);
  assert.equal(requests, 1);
  await page.locator(".brand").click();
  await page.keyboard.press("Control+z");
  await expect(
    summary.getByRole("button", { name: "Apply change", exact: true }),
  ).toBeEnabled();
  assert.equal((await stored()).jobs[0].tailoredDocId, undefined);
  await summary
    .getByRole("button", { name: "Apply change", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit headline", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Edit headline", exact: true })
    .fill("Manually edited headline");
  await page
    .getByRole("textbox", { name: "Edit headline", exact: true })
    .press("Enter");
  await expect(
    headline.getByRole("button", { name: "Apply change", exact: true }),
  ).toBeDisabled();
  await headline
    .getByText("This field changed. Ask for an updated suggestion.", {
      exact: true,
    })
    .waitFor();
  await headline.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(headline).toHaveCount(0);
  await bullet
    .getByRole("button", { name: "Apply change", exact: true })
    .click();
  await expect(
    bullet.getByRole("button", { name: "Applied", exact: true }),
  ).toBeDisabled();
  saved = await stored();
  assert.deepEqual(saved.docs["j:first"].roles[0].bullets, [
    "Built React applications.",
    "Created a React dashboard.",
  ]);
  await page.reload();
  await ready();
  await open();
  await expect(page.locator(".chat-change")).toHaveCount(2);
  await expect(
    summary.getByRole("button", { name: "Applied", exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await summary.scrollIntoViewIfNeeded();
  assert.ok(
    await page
      .locator(".chat-messages")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  );
  await page.screenshot({ path: "test-results/chat-changes-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .locator(".job-card")
    .filter({ hasText: "second employer" })
    .click();
  await expect(page.locator(".chat-change")).toHaveCount(0);
  await page.locator(".job-card").filter({ hasText: "first employer" }).click();
  await expect(page.locator(".chat-change")).toHaveCount(2);
  await page.locator(".template-row").click();
  await expect(page.locator(".chat-change")).toHaveCount(0);
  await send();
  await summary
    .getByText("Engineering · Base template", { exact: true })
    .waitFor();
  await summary
    .getByRole("button", { name: "Apply change", exact: true })
    .click();
  await expect(
    summary.getByRole("button", { name: "Applied", exact: true }),
  ).toBeDisabled();
  saved = await stored();
  assert.equal(saved.docs["t:base"].summary, "Edited template summary.");
  assert.equal(
    saved.docs["j:first"].summary,
    "React engineer with application development experience.",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Chat change browser checks passed: reviewed diffs, explicit apply, isolated job edits, undo, stale edits, dismissal, saved suggestions, template edits, and mobile layout.",
  );
} finally {
  await browser.close();
}
