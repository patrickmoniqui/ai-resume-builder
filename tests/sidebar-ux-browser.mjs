import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { blankResume, initialWorkspace } from "../lib/initial.ts";

const directory = await mkdtemp(path.join(tmpdir(), "sidebar-ux-"));
const probe = createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    env: { ...process.env, RESUME_BUILDER_DATA_DIR: directory },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
server.stdout.on("data", (data) => {
  logs = (logs + data).slice(-3000);
});
server.stderr.on("data", (data) => {
  logs = (logs + data).slice(-3000);
});
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(logs);
    try {
      if ((await fetch(base)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, logs);
  browser = await chromium.launch({
    executablePath:
      process.env.BROWSER_EXECUTABLE_PATH ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined),
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const w = initialWorkspace();
  w.templates = ["Platform_Resume", "AI_Resume"].map((name) => ({
    id: name,
    docId: name,
    name,
    source: "Uploaded",
    sourceFile: "",
  }));
  w.docs = Object.fromEntries(
    w.templates.map((t) => [
      t.id,
      {
        ...blankResume(),
        name: "Alex Morgan",
        headline: t.name,
        skills: "React",
      },
    ]),
  );
  w.jobs = Array.from({ length: 18 }, (_, i) => ({
    id: `job-${i}`,
    title: i === 0 ? "Senior Platform Engineer" : `Engineer ${i}`,
    company: i === 0 ? "Acme" : `Company ${i}`,
    templateId: i % 2 ? "AI_Resume" : "Platform_Resume",
    location: "Montréal",
    source: "Pasted description",
    rawDescription: "React required",
    keywords: [{ term: "React", required: true, category: "Tools" }],
    status: i % 2 ? "applied" : "to-apply",
  }));
  w.selectedJobId = "job-0";
  w.viewTemplateId = null;
  await page.addInitScript((w) => {
    if (!localStorage.getItem("sidebar-test-seeded")) {
      localStorage.setItem("resume-builder.workspace.v1", JSON.stringify(w));
      localStorage.setItem("sidebar-test-seeded", "true");
    }
  }, w);
  await page.goto(base);
  const jobs = page.getByRole("tab", { name: /^Jobs/ });
  const resumes = page.getByRole("tab", { name: /^Resumes/ });
  await expect(jobs).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".job-card")).toHaveCount(18);
  await expect(page.locator("#sidebar-resumes-panel")).toBeHidden();
  await expect(page.getByLabel("Filter jobs by status")).toBeHidden();
  const documentBefore = await page.locator(".document-bar").innerText();
  await resumes.click();
  await expect(page.locator(".topbar .source-info")).toHaveCount(0);
  await expect(
    page
      .locator(".topbar")
      .getByRole("button", { name: "Import resume", exact: true }),
  ).toHaveCount(0);
  await page
    .locator("#sidebar-resumes-panel")
    .getByRole("button", { name: "Import resume", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Import resume" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(page.locator("#sidebar-jobs-panel")).toBeHidden();
  assert.equal(await page.locator(".document-bar").innerText(), documentBefore);
  await resumes.press("ArrowLeft");
  await expect(jobs).toBeFocused();
  await expect(jobs).toHaveAttribute("aria-selected", "true");
  const filters = page.getByRole("button", { name: /^Filters/ });
  await filters.click();
  await page.getByLabel("Filter jobs by status").selectOption("applied");
  await page.getByLabel("Filter jobs by resume").selectOption("AI_Resume");
  await expect(page.locator(".job-card")).toHaveCount(9);
  await page.getByRole("checkbox", { name: "Company 1", exact: true }).check();
  await page.getByRole("checkbox", { name: "Company 3", exact: true }).check();
  await expect(page.locator(".job-card")).toHaveCount(2);
  await expect(filters).toHaveText("Filters3");
  await page.getByLabel("Filter jobs by resume").press("Escape");
  await expect(filters).toBeFocused();
  await expect(page.getByLabel("Filter jobs by status")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Remove status filter" }),
  ).toBeVisible();
  await resumes.click();
  await jobs.click();
  await expect(page.locator(".job-card")).toHaveCount(2);
  await page
    .getByRole("button", {
      name: "Remove company filter Company 3",
      exact: true,
    })
    .click();
  await expect(page.locator(".job-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Remove company filter Company 1" })
    .click();
  await expect(page.locator(".job-card")).toHaveCount(9);
  await page.getByRole("button", { name: "Remove status filter" }).click();
  await page.getByRole("button", { name: "Remove resume filter" }).click();
  await page.getByRole("searchbox", { name: "Search jobs" }).fill("Acme");
  await expect(page.locator(".job-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await filters.click();
  await page.getByRole("checkbox", { name: "Acme", exact: true }).check();
  await page
    .getByRole("button", { name: "All companies", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Acme", exact: true }),
  ).not.toBeChecked();
  await expect(page.locator(".job-card")).toHaveCount(18);
  await page.getByRole("checkbox", { name: "Acme", exact: true }).check();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Acme", exact: true }),
  ).not.toBeChecked();
  await expect(page.locator(".job-card")).toHaveCount(18);
  await page.getByRole("checkbox", { name: "Acme", exact: true }).check();
  await page.locator(".document-bar").click();
  await expect(filters).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator(".job-card")).toHaveCount(18);
  await page.locator(".job-card").nth(1).click();
  await expect(page.locator("#job-details-job-0")).toBeHidden();
  await expect(page.locator("#job-details-job-1")).toBeVisible();
  await page
    .getByLabel("Status for Engineer 1 at Company 1")
    .selectOption("rejected");
  await expect(
    page.locator(".job-card.selected .job-summary-status"),
  ).toContainText("Rejected");
  await expect(page.locator(".assigned-resume")).toContainText("AI Resume");
  await page.getByLabel("Base template").selectOption("Platform_Resume");
  await expect(page.locator(".assigned-resume")).toContainText(
    "Platform Resume",
  );
  await page.locator(".job-card").nth(1).focus();
  await page.locator(".job-card").nth(1).press("Alt+ArrowUp");
  await expect(page.locator(".job-card").first()).toContainText("Company 1");
  await resumes.click();
  await page
    .getByRole("button", {
      name: "Actions for resume Platform_Resume",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Rename resume Platform_Resume",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Duplicate resume Platform_Resume",
      exact: true,
    })
    .click();
  await expect(page.locator(".template-row")).toHaveCount(3);
  await page.getByRole("button", { name: "Create empty resume" }).click();
  await expect(page.locator(".template-row")).toHaveCount(4);
  await page
    .getByRole("button", {
      name: "Actions for resume Platform_Resume",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Rename resume Platform_Resume", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Actions for resume Platform_Resume",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "Delete template Platform_Resume",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await jobs.click();
  await expect(jobs).toHaveAttribute("aria-selected", "true");
  await page.locator(".job-card").filter({ hasText: "Acme" }).click();
  await expect(page.locator("#job-details-job-0")).toBeVisible();
  await page.screenshot({ path: "/tmp/sidebar-ux-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  // Close the right tools drawer to inspect the left drawer at mobile width.
  const rightToggle = page.getByRole("button", {
    name: "Toggle right tools panel",
  });
  if (await rightToggle.count()) await rightToggle.click();
  await filters.click();
  const bounds = await page.locator("#job-filters").boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390);
  await page.screenshot({ path: "/tmp/sidebar-ux-mobile.png" });
  await page.keyboard.press("Escape");
  await resumes.click();
  await expect(
    page.getByRole("button", { name: "Create empty resume" }),
  ).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    "Sidebar UX passed: tabs preserve context, keyboard navigation, filters and chips, status, resume assignment, reorder, resume actions, and mobile bounds.",
  );
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  await new Promise((resolve) =>
    server.exitCode !== null ? resolve() : server.once("exit", resolve),
  );
  await rm(directory, { recursive: true, force: true });
}
