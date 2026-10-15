import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { blankResume, initialWorkspace } from "../lib/initial.ts";
import { saveAssessment } from "../lib/saved-matches.ts";

const doc = { ...blankResume(), name: "Applicant", skills: "React" };
const templateName = "Sample_Applicant_Resume_2026";
const jobs = [
  {
    id: "studio",
    company: "Example Studio",
    title: "Senior Backend Developer, Internal AI Tooling (Engine AI)",
    status: "applied",
    location: "Montréal, Canada",
    pct: 32,
  },
  {
    id: "engineering",
    company: "Example Engineering",
    title: "Software Engineer (.NET / C# and AI/IoT)",
    status: "to-apply",
    location: "Montréal",
    pct: 45,
    tailoredDocId: "j:engineering",
  },
].map(({ pct, ...job }) => {
  const keyword = { term: "React", category: "Tools", required: true };
  const record = {
    ...job,
    templateId: "base",
    source: "Pasted description",
    rawDescription: "Build applications",
    keywords: [keyword],
  };
  return {
    ...record,
    assessment: saveAssessment(
      {
        method: "apiKey",
        provider: "anthropic",
        model: "test-model",
        key: "test-key",
      },
      record,
      doc,
      {
        pct,
        summary: "Saved assessment",
        matched: 1,
        required: 1,
        requiredMatched: 1,
        items: [
          {
            ...keyword,
            keywordIndex: 0,
            kind: "technology",
            matched: true,
            count: 1,
            evidence: "React",
            reason: "Listed in the resume",
          },
        ],
      },
    ),
  };
});
const workspace = {
  ...initialWorkspace(),
  templates: [
    {
      id: "base",
      docId: "t:base",
      name: templateName,
      source: "Uploaded",
      sourceFile: "resume.pdf",
    },
  ],
  docs: { "t:base": doc, "j:engineering": doc },
  jobs,
  selectedJobId: "studio",
};
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
await page.addInitScript((workspace) => {
  localStorage.setItem(
    "resume-builder.workspace.v1",
    JSON.stringify(workspace),
  );
  localStorage.setItem(
    "resume-builder.panel-widths.v1",
    JSON.stringify({ left: 340, right: 320 }),
  );
}, workspace);
try {
  await page.goto(process.env.TEST_BASE_URL || "http://localhost:3000");
  await page.getByText("Saved on this device", { exact: true }).waitFor();
  await expect(page.locator(".job-card-header .score-pill")).toHaveText([
    "32%",
    "45%",
  ]);
  await expect(page.locator(".job-tailored-badge")).toHaveText("Tailored");
  await expect(page.locator(".job-template-name").first()).toHaveText(
    "Sample Applicant Resume 2026",
  );
  assert.equal(
    await page.locator(".job-template-tag").first().getAttribute("title"),
    templateName,
  );
  const check = async () => {
    for (const card of await page.locator(".job-item").all()) {
      assert.ok(
        await card.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      );
      const header = await card.locator(".job-card-header").boundingBox();
      const title = await card.locator(".job-title").boundingBox();
      assert.ok(title.y >= header.y + header.height + 4);
      const company = await card.locator(".company").boundingBox();
      const status = await card.locator(".job-status").boundingBox();
      const score = await card.locator(".score-pill").boundingBox();
      assert.ok(company.x + company.width < status.x);
      assert.ok(status.x + status.width + 4 <= score.x);
      const tag = await card.locator(".job-template-tag").boundingBox();
      assert.ok(tag.x + tag.width <= header.x + header.width + 1);
    }
  };
  await check();
  await fs.mkdir("test-results", { recursive: true });
  const first = await page.locator(".job-item").first().boundingBox();
  const last = await page.locator(".job-item").last().boundingBox();
  await page.screenshot({
    path: "test-results/job-cards-refined.png",
    clip: {
      x: first.x,
      y: first.y,
      width: first.width,
      height: last.y + last.height - first.y,
    },
  });
  const resize = page.getByRole("separator", {
    name: "Resize templates and jobs panel",
    exact: true,
  });
  await resize.focus();
  await resize.press("Home");
  await check();
  await page.setViewportSize({ width: 390, height: 844 });
  await check();
  const status = page.getByLabel(
    "Status for Senior Backend Developer, Internal AI Tooling (Engine AI) at Example Studio",
    { exact: true },
  );
  await status.selectOption("");
  await expect(status).toHaveClass(/unset/);
  assert.equal(
    await page
      .locator(".job-item")
      .first()
      .locator(".job-status-separator")
      .count(),
    0,
  );
  await status.selectOption("to-apply");
  await expect(status).toHaveValue("to-apply");
  await check();
  assert.deepEqual(errors, []);
  console.log(
    "Job card UI checks passed: long titles and names, status/score alignment, template labels, narrow panels, mobile, and manual status controls.",
  );
} finally {
  await browser.close();
}
