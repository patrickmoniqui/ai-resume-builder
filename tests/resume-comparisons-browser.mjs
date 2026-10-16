import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { blankResume, initialWorkspace } from "../lib/initial.ts";
import { saveAssessment } from "../lib/saved-matches.ts";

const directory = await mkdtemp(path.join(tmpdir(), "resume-comparisons-"));
const probe = createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
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
let browser;
try {
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({
    executablePath:
      process.env.BROWSER_EXECUTABLE_PATH ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined),
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const w = initialWorkspace();
  w.templates = ["Attached", "Frontend", "General"].map((name) => ({
    id: name,
    docId: name,
    name,
    source: "Uploaded",
    sourceFile: "",
  }));
  w.docs = Object.fromEntries(
    ["Attached", "Frontend", "General", "Tailored"].map((name) => [
      name,
      { ...blankResume(), name: "Applicant", headline: name, skills: "React" },
    ]),
  );
  const job = {
    id: "job",
    templateId: "Attached",
    title: "Engineer",
    company: "Example",
    location: "",
    source: "Pasted",
    rawDescription: "React required",
    keywords: [{ term: "React", required: true, category: "Tools" }],
  };
  const connection = {
    method: "apiKey",
    provider: "openai",
    model: "test-model",
    key: "test-only",
  };
  const output = {
    pct: 82,
    summary: "Strong React evidence",
    items: [
      {
        ...job.keywords[0],
        keywordIndex: 0,
        kind: "technology",
        matched: true,
        evidence: "React",
        reason: "Listed in skills",
      },
    ],
    matched: 1,
    required: 1,
    requiredMatched: 1,
  };
  job.assessment = saveAssessment(connection, job, w.docs.Attached, output);
  job.comparisonAssessments = {
    Frontend: saveAssessment(connection, job, w.docs.Frontend, output),
  };
  w.jobs = [
    job,
    {
      ...job,
      id: "other",
      title: "Designer",
      company: "Studio",
      tailoredDocId: "Tailored",
    },
  ];
  w.selectedJobId = "job";
  await page.addInitScript(
    ({ w, connection }) => {
      if (!localStorage.getItem("comparison-test-seeded")) {
        localStorage.setItem("resume-builder.workspace.v1", JSON.stringify(w));
        localStorage.setItem(
          "resume-builder.ai-connection.v1",
          JSON.stringify(connection),
        );
        localStorage.setItem(
          "resume-builder.panel-widths.v1",
          JSON.stringify({ left: 300, right: 340 }),
        );
        localStorage.setItem("comparison-test-seeded", "true");
      }
    },
    { w, connection },
  );
  const requests = [];
  let fail = true;
  await page.route("**/api/match", async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body.doc.headline);
    await route.fulfill({
      status: fail ? 500 : 200,
      contentType: "application/json",
      body: JSON.stringify(fail ? { error: "Test assessment failed" } : output),
    });
  });
  await page.goto(base);
  await page
    .getByText("Saved on this computer", { exact: true })
    .waitFor({ timeout: 10000 })
    .catch(async (error) => {
      console.log(await page.locator("body").innerText());
      console.log(errors);
      throw error;
    });
  await page
    .getByRole("button", { name: "Compare resumes", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Compare resumes" });
  await expect(dialog.getByRole("checkbox")).toHaveCount(3);
  await dialog
    .getByRole("checkbox", { name: "Frontend Template", exact: true })
    .check();
  await dialog
    .getByRole("checkbox", {
      name: "Designer · Studio Tailored resume",
      exact: true,
    })
    .check();
  await expect(
    dialog.getByRole("checkbox", { name: "General Template", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Save comparison", exact: true })
    .click();
  await expect(page.locator(".comparison-ring")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Reassess with AI", exact: true })
    .click();
  await expect(
    page.getByText("Assessment failed", { exact: true }),
  ).toBeVisible();
  assert.deepEqual(requests, ["Tailored"]);
  fail = false;
  await page
    .getByRole("button", { name: "Reassess with AI", exact: true })
    .click();
  await expect(page.locator(".comparison-ring > strong")).toHaveText([
    "82%",
    "82%",
  ]);
  assert.deepEqual(requests, ["Tailored", "Tailored"]);
  const rings = page.locator(".score-block > .score-ring, .comparison-ring");
  const bounds = await rings.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width };
    }),
  );
  assert.ok(bounds[1].x > bounds[0].x && bounds[2].x > bounds[1].x);
  assert.ok(bounds[1].width < bounds[0].width);
  await page.locator(".comparison-ring").last().focus();
  await expect(
    page.locator(".comparison-ring").last().getByRole("tooltip"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reassess with AI", exact: true })
    .click();
  await expect(
    page.getByText("All selected resume assessments are up to date.", {
      exact: true,
    }),
  ).toBeVisible();
  assert.equal(requests.length, 2);
  await page.getByText("Saved on this computer", { exact: true }).waitFor();
  await page.reload();
  await expect(page.locator(".comparison-ring > strong")).toHaveText([
    "82%",
    "82%",
  ]);
  await page.getByRole("button", { name: "Edit name", exact: true }).click();
  const name = page.getByRole("textbox", { name: "Edit name", exact: true });
  await name.fill("Updated Applicant");
  await name.press("Tab");
  await page
    .getByRole("button", { name: "Reassess with AI", exact: true })
    .click();
  await expect.poll(() => requests.length).toBe(3);
  assert.equal(requests[2], "Attached");
  await expect(
    page.getByRole("button", { name: "Reassess with AI", exact: true }),
  ).toBeEnabled();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/resume-comparisons.png" });
  const checkTooltips = async () => {
    const panel = await page.locator(".match-tool-panel").boundingBox();
    for (const ring of await page.locator(".comparison-ring").all()) {
      await ring.focus();
      const tooltip = ring.getByRole("tooltip");
      await expect(tooltip).toBeVisible();
      const bounds = await tooltip.boundingBox();
      assert.ok(
        bounds.x >= panel.x - 1 &&
          bounds.x + bounds.width <= panel.x + panel.width + 1,
        "Tooltip stays within the matching panel",
      );
    }
  };
  await checkTooltips();
  const resize = page.getByRole("separator", {
    name: "Resize right tools panel",
    exact: true,
  });
  await resize.focus();
  await resize.press("Home");
  await checkTooltips();
  const panelFits = await page
    .locator(".match-tool-panel")
    .evaluate((el) => el.scrollWidth <= el.clientWidth);
  if (!panelFits)
    console.log(
      await page.locator(".match-tool-panel").evaluate((el) => ({
        width: el.clientWidth,
        scroll: el.scrollWidth,
        overflow: [...el.querySelectorAll("*")]
          .filter(
            (child) =>
              child.getBoundingClientRect().right >
              el.getBoundingClientRect().right + 1,
          )
          .map((child) => child.className)
          .slice(0, 15),
      })),
    );
  assert.ok(panelFits, "Comparison scores fit the minimum panel width");
  await page.setViewportSize({ width: 390, height: 844 });
  await checkTooltips();
  await page.screenshot({ path: "test-results/resume-comparisons-mobile.png" });
  assert.deepEqual(errors, []);
  console.log(
    "Comparison browser checks passed: picker limit, both sources, score layout/tooltips, failure/retry, changed-only reassessment, no-op, persistence and attached resume editing.",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));
  await rm(directory, { recursive: true, force: true });
}
