import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { blankResume, initialWorkspace } from "../lib/initial.ts";
import { buildResumePDF } from "../lib/resume-pdf.ts";

const original = {
  ...blankResume(),
  name: "Original Applicant",
  summary: "Original summary",
  pageCount: 2,
  roles: [
    {
      company: "Acme",
      title: "Engineer",
      dates: "2020–2024",
      bullets: ["Original bullet"],
    },
  ],
  extraSections: [{ title: "Projects", text: "Original project" }],
};
const workspace = {
  ...initialWorkspace(),
  templates: [
    {
      id: "base",
      name: "Engineering",
      source: "Uploaded file",
      sourceFile: "engineering.pdf",
      docId: "t:base",
    },
    {
      id: "other",
      name: "Leadership",
      source: "Created here",
      sourceFile: "Leadership",
      docId: "t:other",
    },
  ],
  docs: {
    "t:base": original,
    "t:other": { ...blankResume(), name: "Other Applicant" },
    "j:job": { ...original, name: "Tailored Applicant" },
  },
  jobs: [
    {
      id: "job",
      templateId: "base",
      tailoredDocId: "j:job",
      company: "Employer",
      title: "Engineer",
      location: "Remote",
      source: "Pasted",
      rawDescription: "Build React apps",
      keywords: [{ term: "React", category: "Tools", required: true }],
    },
  ],
  notes: [
    { id: "note", text: "Keep this note", createdAt: "2026-10-06T00:00:00Z" },
  ],
  selectedJobId: "job",
};
const bytes = Array.from(await buildResumePDF(original));
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
  if (localStorage.getItem("resume-builder.workspace.v1")) return;
  localStorage.setItem(
    "resume-builder.workspace.v1",
    JSON.stringify(workspace),
  );
  localStorage.setItem("resume-builder.page-count.v1", "1");
}, workspace);
const saved = () =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("resume-builder.workspace.v1")),
  );
const ready = () =>
  page.getByText("Saved on this device", { exact: true }).waitFor();
const copied = async (count, name) => {
  await expect.poll(async () => (await saved()).templates.length).toBe(count);
  const current = await saved();
  const copy = current.templates.at(-1);
  assert.equal(copy.name, name);
  assert.equal(current.viewTemplateId, copy.id);
  assert.notEqual(copy.docId, "t:base");
  assert.deepEqual(current.docs[copy.docId], original);
  assert.deepEqual(current.docs["t:base"], original);
  assert.deepEqual(current.jobs, workspace.jobs);
  assert.deepEqual(current.notes, workspace.notes);
  assert.equal(new Set(current.templates.map((t) => t.name)).size, count);
  return copy;
};
try {
  await page.goto(process.env.TEST_BASE_URL || "http://localhost:3000");
  await ready();
  await page.evaluate(async (bytes) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("resume-builder.sources.v1", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("sources");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("sources", "readwrite");
      transaction.objectStore("sources").put(
        {
          file: new Blob([new Uint8Array(bytes)], {
            type: "application/pdf",
          }),
          name: "engineering.pdf",
          text: "Original PDF text",
        },
        "base",
      );
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, bytes);
  await page
    .getByRole("button", { name: "Duplicate resume Engineering", exact: true })
    .click();
  const first = await copied(3, "Engineering_copy");
  const source = await page.evaluate(async (id) => {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open("resume-builder.sources.v1", 1);
      request.onsuccess = () => resolve(request.result);
    });
    const source = await new Promise((resolve) => {
      const request = db
        .transaction("sources", "readonly")
        .objectStore("sources")
        .get(id);
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return {
      name: source.name,
      text: source.text,
      bytes: Array.from(new Uint8Array(await source.file.arrayBuffer())),
    };
  }, first.id);
  assert.deepEqual(source, {
    name: "engineering.pdf",
    text: "Original PDF text",
    bytes,
  });
  await page.getByRole("button", { name: "Edit name", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Edit name", exact: true })
    .fill("Copy Applicant");
  await page
    .getByRole("textbox", { name: "Edit name", exact: true })
    .press("Enter");
  await page.getByRole("button", { name: "Edit bullet", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Edit bullet", exact: true })
    .fill("Copy-only bullet");
  await page
    .getByRole("textbox", { name: "Edit bullet", exact: true })
    .press("Tab");
  await expect
    .poll(async () => (await saved()).docs[first.docId].roles[0].bullets[0])
    .toBe("Copy-only bullet");
  assert.deepEqual((await saved()).docs["t:base"], original);
  await page
    .getByRole("button", { name: "Duplicate resume Engineering", exact: true })
    .click();
  await copied(4, "Engineering_copy_2");
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await copied(5, "Engineering_copy_2_copy");
  await page.reload();
  await ready();
  assert.equal((await saved()).docs[first.docId].name, "Copy Applicant");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page
    .getByRole("button", { name: "Expand templates and jobs", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Duplicate resume Engineering", exact: true })
    .click();
  await copied(6, "Engineering_copy_3");
  await page
    .getByRole("button", { name: "Rename resume Engineering", exact: true })
    .click();
  await page.getByLabel("Resume name", { exact: true }).fill("Canceled name");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal((await saved()).templates[0].name, "Engineering");
  await page
    .getByRole("button", { name: "Rename resume Engineering", exact: true })
    .click();
  await page.getByLabel("Resume name", { exact: true }).fill("   ");
  await expect(
    page.getByRole("button", { name: "Save name", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Resume name", { exact: true }).fill(" leadership ");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Rename resume", exact: true })
      .getByRole("alert"),
  ).toHaveText("A resume already uses this name.");
  await page
    .getByLabel("Resume name", { exact: true })
    .fill(" Engineering Senior ");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(async () => (await saved()).templates[0].name)
    .toBe("Engineering Senior");
  assert.equal((await saved()).templates[0].id, "base");
  assert.equal((await saved()).templates[0].sourceFile, "engineering.pdf");
  assert.deepEqual((await saved()).docs["t:base"], original);
  assert.deepEqual((await saved()).jobs, workspace.jobs);
  assert.equal(
    await page.locator(".job-template-tag").first().getAttribute("title"),
    "Engineering Senior",
  );
  await page
    .getByRole("button", {
      name: "Duplicate resume Engineering Senior",
      exact: true,
    })
    .click();
  await copied(7, "Engineering_Senior_copy");
  await page
    .getByRole("button", {
      name: "Duplicate resume Engineering Senior",
      exact: true,
    })
    .click();
  await copied(8, "Engineering_Senior_copy_2");
  await page.reload();
  await page
    .getByRole("button", { name: "Expand templates and jobs", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Rename resume Engineering Senior",
      exact: true,
    }),
  ).toBeVisible();
  assert.equal((await saved()).templates[0].name, "Engineering Senior");
  assert.deepEqual(errors, []);
  console.log(
    "Resume duplication and rename browser checks passed: independent copies, original PDFs, unique names, cancel, validation, label-only rename, job links, renamed copies, persistence, and mobile.",
  );
} finally {
  await browser.close();
}
