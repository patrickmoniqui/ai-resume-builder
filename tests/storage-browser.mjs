import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

// Always use an isolated database and temporary ports. Never touch the user's workspace.
const directory = await mkdtemp(path.join(tmpdir(), "resume-storage-browser-"));
const artifacts = path.resolve("test-results/storage");
await mkdir(artifacts, { recursive: true });
const children = [];
let browser;
const errors = [];
async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
async function start(port) {
  const child = spawn(
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
  children.push(child);
  let output = "";
  child.stdout.on("data", (chunk) => {
    output = (output + chunk).slice(-4000);
  });
  child.stderr.on("data", (chunk) => {
    output = (output + chunk).slice(-4000);
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null)
      throw new Error(`Test server failed: ${output}`);
    try {
      if ((await fetch(url)).ok) return { url, child };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Test server did not become ready: ${output}`);
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}
async function state(url) {
  const response = await fetch(url + "/api/storage");
  const body = await response.json();
  if (!response.ok)
    throw new Error(`Storage HTTP ${response.status}: ${body.error}`);
  return body;
}
async function api(url, method, body, suffix = "") {
  return fetch(url + "/api/storage" + suffix, {
    method,
    headers: { origin: url, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function saved(page) {
  await expect(
    page.getByText("Saved on this computer", { exact: true }),
  ).toBeVisible();
}
async function editSummary(page, value) {
  await page.getByRole("button", { name: "Edit summary", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Edit summary", exact: true })
    .fill(value);
  await page
    .getByRole("textbox", { name: "Edit summary", exact: true })
    .press("Escape");
}

try {
  const first = await start(await freePort());
  const second = await start(await freePort());
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText("Original resume for migration verification", {
    font,
    x: 40,
    y: 750,
  });
  const pdfData = Buffer.from(await pdf.save()).toString("base64");
  const workspace = {
    templates: [
      {
        id: "legacy",
        name: "Legacy_Resume",
        sourceFile: "legacy.pdf",
        source: "Uploaded file",
        docId: "t:legacy",
      },
    ],
    docs: {
      "t:legacy": {
        name: "Legacy Person",
        headline: "Engineer",
        contact: "",
        summary: "Recovered summary",
        skills: "TypeScript",
        roles: [],
        edu: [],
      },
    },
    jobs: [
      {
        id: "legacy-job",
        templateId: "legacy",
        company: "Example",
        title: "Engineer",
        location: "Remote",
        source: "Pasted",
        rawDescription: "Build things",
        keywords: [
          { term: "TypeScript", category: "Hard skills", required: true },
        ],
      },
    ],
    references: [
      {
        id: "ref",
        name: "reference.txt",
        type: "txt",
        size: 9,
        createdAt: "2026-10-07",
      },
    ],
    notes: [{ id: "n", text: "Preserve me", createdAt: "2026-10-07" }],
    selectedJobId: "legacy-job",
    viewTemplateId: "legacy",
  };
  browser = await chromium.launch({
    executablePath:
      process.env.BROWSER_EXECUTABLE_PATH ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined),
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(first.url + "/recovery.html");
  await page.evaluate(
    async ({ workspace, pdfData }) => {
      localStorage.setItem(
        "resume-builder.workspace.v1",
        JSON.stringify(workspace),
      );
      localStorage.setItem("resume-builder.page-count.v1", "2");
      localStorage.setItem(
        "resume-builder.chat-history.v1",
        JSON.stringify({
          workspace: [{ role: "user", content: "Legacy question" }],
          "job:legacy-job": [{ role: "user", content: "Job question" }],
        }),
      );
      localStorage.setItem(
        "resume-builder.chat-instructions.v1",
        "Legacy instructions",
      );
      localStorage.setItem(
        "resume-builder.ai-connection.v1",
        JSON.stringify({
          method: "apiKey",
          provider: "openai",
          model: "test",
          key: "credential-must-not-be-exported",
        }),
      );
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("resume-builder.sources.v1", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("sources");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction("sources", "readwrite");
        tx.objectStore("sources").put(
          {
            name: "legacy.pdf",
            text: "Original resume text",
            file: new Blob(
              [Uint8Array.from(atob(pdfData), (c) => c.charCodeAt(0))],
              { type: "application/pdf" },
            ),
          },
          "legacy",
        );
        tx.objectStore("sources").put(
          {
            name: "reference.txt",
            text: "Reference",
            file: new Blob(["Reference"], { type: "text/plain" }),
          },
          "reference:ref",
        );
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { workspace, pdfData },
  );
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download browser backup", exact: true })
    .click();
  const legacyDownload = await downloadEvent;
  await legacyDownload.saveAs(path.join(artifacts, "browser-backup.json"));
  const legacyText = await readFile(
    path.join(artifacts, "browser-backup.json"),
    "utf8",
  );
  const legacyBundle = JSON.parse(legacyText);
  assert.equal(legacyBundle.sources.length, 2);
  assert.equal(legacyText.includes("credential-must-not-be-exported"), false);
  assert.equal(
    (await state(first.url)).initialized,
    false,
    "recovery page must not write the database",
  );

  // The portable tool can run at an old origin even if its recovery page is absent.
  await page.goto(first.url + "/unrelated-application-page");
  await page.addScriptTag({ url: second.url + "/browser-recovery.js" });
  const portableEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download browser backup", exact: true })
    .click();
  await (
    await portableEvent
  ).saveAs(path.join(artifacts, "portable-browser-backup.json"));
  const portable = JSON.parse(
    await readFile(
      path.join(artifacts, "portable-browser-backup.json"),
      "utf8",
    ),
  );
  assert.equal(portable.origin, first.url);
  assert.equal(
    portable.sources.find((source) => source.id === "legacy").data,
    pdfData,
  );
  assert.equal((await state(first.url)).initialized, false);

  await page.goto(first.url);
  await saved(page);
  await expect(page.locator(".resume-name")).toHaveText("Legacy Person");
  assert.equal((await state(first.url)).workspace.notes[0].text, "Preserve me");
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("resume-builder.workspace.v1")),
    ),
    workspace,
    "migration leaves browser copy intact",
  );
  assert.equal(
    (
      await (await fetch(first.url + "/api/storage?mode=export")).json()
    ).sources.find((s) => s.id === "legacy").data,
    pdfData,
  );

  const otherContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const other = await otherContext.newPage();
  other.on("pageerror", (e) => errors.push(e.message));
  await other.goto(second.url);
  await saved(other);
  await expect(other.locator(".resume-name")).toHaveText("Legacy Person");
  assert.equal(
    await other.evaluate(() =>
      localStorage.getItem("resume-builder.workspace.v1"),
    ),
    null,
  );
  await other.goto(second.url.replace("127.0.0.1", "localhost"));
  await saved(other);
  await expect(other.locator(".resume-name")).toHaveText("Legacy Person");

  await page.route("**/api/chat", (route) =>
    route.fulfill({ json: { reply: "Saved database reply", changes: [] } }),
  );
  await page.getByRole("button", { name: "AI chatbot", exact: true }).click();
  await expect(page.locator(".chat-message")).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "Message AI", exact: true })
    .fill("New question");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("Saved database reply", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (
          await (
            await fetch(first.url + "/api/storage/chats?scope=workspace")
          ).json()
        ).messages.length,
    )
    .toBe(3);
  await page.getByRole("button", { name: "Instructions", exact: true }).click();
  await expect(
    page.getByRole("textbox", {
      name: "Chat instructions / system prompt",
      exact: true,
    }),
  ).toHaveValue("Legacy instructions");
  await page
    .getByRole("textbox", {
      name: "Chat instructions / system prompt",
      exact: true,
    })
    .fill("New database instructions");
  await page
    .getByRole("button", { name: "Save instructions", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await fetch(first.url + "/api/storage/settings")).json())
          .instructions,
    )
    .toBe("New database instructions");
  await page
    .getByRole("button", { name: "Close AI chatbot", exact: true })
    .click();
  await editSummary(page, "Persisted across ports and restart");
  await expect
    .poll(
      async () => (await state(second.url)).workspace.docs["t:legacy"].summary,
    )
    .toBe("Persisted across ports and restart");
  await saved(page);

  // An older browser context cannot overwrite these edits.
  await editSummary(other, "Stale edit from another browser");
  await expect(other.locator(".storage-notice")).toContainText(
    "Another tab changed this workspace",
  );
  assert.equal(
    (await state(first.url)).workspace.docs["t:legacy"].summary,
    "Persisted across ports and restart",
  );
  const draftEvent = other.waitForEvent("download");
  await other
    .getByRole("button", { name: "Download unsaved work", exact: true })
    .click();
  await (await draftEvent).saveAs(path.join(artifacts, "unsaved-draft.json"));
  assert.equal(
    JSON.parse(
      await readFile(path.join(artifacts, "unsaved-draft.json"), "utf8"),
    ).workspace.docs["t:legacy"].summary,
    "Stale edit from another browser",
  );
  await other.close();

  // Save errors remain visible and the Retry control saves the pending content.
  await page.route("**/api/storage", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 503,
          json: { error: "Simulated disk failure" },
        })
      : route.continue(),
  );
  await editSummary(page, "Retry this pending edit");
  await expect(page.locator(".storage-notice")).toContainText(
    "Simulated disk failure",
  );
  assert.equal(
    (await state(first.url)).workspace.docs["t:legacy"].summary,
    "Persisted across ports and restart",
  );
  await page.unroute("**/api/storage");
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await saved(page);
  assert.equal(
    (await state(first.url)).workspace.docs["t:legacy"].summary,
    "Retry this pending edit",
  );

  await page
    .getByRole("button", { name: "Backup & recovery", exact: true })
    .click();
  const backupEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download backup", exact: true })
    .click();
  await (
    await backupEvent
  ).saveAs(path.join(artifacts, "database-backup.json"));
  const databaseBundle = JSON.parse(
    await readFile(path.join(artifacts, "database-backup.json"), "utf8"),
  );
  assert.equal(
    databaseBundle.sources.find((s) => s.id === "legacy").data,
    pdfData,
  );
  assert.equal(databaseBundle.chats.workspace.length, 3);
  await page
    .getByRole("button", { name: "Save snapshot", exact: true })
    .click();
  await expect(
    page.getByText("A recovery snapshot was saved on this computer.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();

  // Original and reference files are included in an atomic reset and restore.
  await page.getByRole("tab", { name: /^Resumes/ }).click();
  await page
    .getByRole("button", { name: "Import resume", exact: true })
    .click();
  await page.getByRole("button", { name: "Start fresh", exact: true }).click();
  await page
    .getByRole("button", { name: "Clear workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Start with your current resume",
      exact: true,
    }),
  ).toBeVisible();
  assert.equal((await state(first.url)).workspace.templates.length, 0);
  await page
    .getByRole("button", { name: "Backup & recovery", exact: true })
    .click();
  await page.locator('input[data-upload="backup"]').setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(databaseBundle)),
  });
  await expect(
    page.getByRole("button", { name: "Import workspace", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Import workspace", exact: true })
    .click();
  await expect(
    page.getByText("Workspace restored.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.locator(".resume-name")).toHaveText("Legacy Person");
  assert.equal(
    (await (await fetch(first.url + "/api/storage?mode=export")).json()).sources
      .length,
    2,
  );
  await page.getByRole("button", { name: "AI chatbot", exact: true }).click();
  await expect(page.locator(".chat-message")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Close AI chatbot", exact: true })
    .click();

  // A failed initial read never puts an empty workspace back into the database.
  const failedPage = await context.newPage();
  let forbiddenWrites = 0;
  await failedPage.route("**/api/storage", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        status: 503,
        json: { error: "Simulated unreadable database" },
      });
    forbiddenWrites++;
    return route.continue();
  });
  await failedPage.goto(first.url);
  await expect(
    failedPage.locator(".storage-loading [role=alert]"),
  ).toContainText("Simulated unreadable database");
  assert.equal(
    await failedPage
      .getByRole("button", { name: "Create empty resume", exact: true })
      .count(),
    0,
  );
  assert.equal(forbiddenWrites, 0);
  await failedPage.close();

  // Stop every database server before restarting: durability must come from disk.
  await page.close();
  await stop(first.child);
  await stop(second.child);
  const restarted = await start(await freePort());
  const after = await otherContext.newPage();
  await after.goto(restarted.url);
  await saved(after);
  await expect(after.locator(".resume-name")).toHaveText("Legacy Person");
  assert.equal(
    (await state(restarted.url)).workspace.docs["t:legacy"].summary,
    "Retry this pending edit",
  );
  await after.screenshot({
    path: path.join(artifacts, "desktop.png"),
    fullPage: true,
  });
  await after.setViewportSize({ width: 390, height: 844 });
  await after.reload();
  await expect(after.locator(".resume-name")).toHaveText("Legacy Person");
  await expect(after.locator(".topbar")).toHaveCount(1);
  await after.screenshot({
    path: path.join(artifacts, "mobile.png"),
    fullPage: true,
  });
  assert.equal(
    await after.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "mobile layout must not overflow horizontally",
  );
  await after
    .getByRole("button", { name: "Backup & recovery", exact: true })
    .click();
  await expect(
    after.getByRole("dialog", { name: "Backup & recovery", exact: true }),
  ).toBeVisible();
  await after.screenshot({
    path: path.join(artifacts, "backup-mobile.png"),
    fullPage: true,
  });
  await after
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  const crossOrigin = await fetch(restarted.url + "/api/storage", {
    method: "PUT",
    headers: {
      origin: "http://attacker.example",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(crossOrigin.status, 403);
  assert.deepEqual(errors, []);
  console.log(
    "Storage browser checks passed: browser recovery, exact file bytes, preserved browser copy, different ports/hostnames/browser contexts, autosave, chats, instructions, conflicts, failed-save retry, backups, reset/import, failed-load guard, restart and mobile layout.",
  );
} finally {
  if (browser) await browser.close();
  await Promise.all(children.map(stop));
  await rm(directory, { recursive: true, force: true });
}
