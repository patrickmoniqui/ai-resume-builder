import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { blankResume, initialWorkspace } from "../lib/initial.ts";

const browser = await chromium.launch({
  executablePath:
    process.env.BROWSER_EXECUTABLE_PATH ||
    (process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined),
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const initial = {
  ...initialWorkspace(),
  notes: [
    {
      id: "note",
      text: "Keep my existing note",
      createdAt: "2026-10-06T00:00:00Z",
    },
  ],
};
await page.addInitScript((workspace) => {
  if (!localStorage.getItem("resume-builder.workspace.v1"))
    localStorage.setItem(
      "resume-builder.workspace.v1",
      JSON.stringify(workspace),
    );
}, initial);
let imports = 0;
await page.route("**/api/import", (route) => {
  imports++;
  return route.abort();
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const saved = () =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("resume-builder.workspace.v1")),
  );
const ready = () =>
  page.getByText("Saved on this device", { exact: true }).waitFor();
const create = () =>
  page
    .getByRole("button", { name: "Create empty resume", exact: true })
    .click();
const checkBlank = async (count) => {
  await expect.poll(async () => (await saved()).templates.length).toBe(count);
  const workspace = await saved();
  const template = workspace.templates.at(-1);
  assert.equal(workspace.viewTemplateId, template.id);
  assert.equal(template.source, "Created here");
  assert.deepEqual(workspace.docs[template.docId], {
    ...blankResume(),
    pageCount: 2,
  });
  assert.equal(new Set(workspace.templates.map((t) => t.name)).size, count);
  assert.deepEqual(workspace.notes, initial.notes);
  return workspace;
};
try {
  await page.goto(process.env.TEST_BASE_URL || "http://localhost:3000");
  await ready();
  await page
    .getByRole("combobox", { name: "Resume page count", exact: true })
    .selectOption("2");
  await create();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const first = (await checkBlank(1)).templates[0];
  await page.getByRole("button", { name: "Edit name", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Edit name", exact: true })
    .fill("Existing Applicant");
  await page
    .getByRole("textbox", { name: "Edit name", exact: true })
    .press("Enter");
  await page.getByRole("button", { name: "Edit summary", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Edit summary", exact: true })
    .fill("Keep this existing resume.");
  await page
    .getByRole("textbox", { name: "Edit summary", exact: true })
    .press("Tab");
  await expect
    .poll(async () => (await saved()).docs[first.docId].summary)
    .toBe("Keep this existing resume.");
  const original = (await saved()).docs[first.docId];
  await create();
  assert.deepEqual((await checkBlank(2)).docs[first.docId], original);
  await page
    .getByRole("button", { name: "Import resume", exact: true })
    .click();
  await page.getByRole("button", { name: "Start blank", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  assert.deepEqual((await checkBlank(3)).docs[first.docId], original);
  await page.reload();
  await ready();
  assert.deepEqual((await checkBlank(3)).docs[first.docId], original);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page
    .getByRole("button", { name: "Expand templates and jobs", exact: true })
    .click();
  await create();
  assert.deepEqual((await checkBlank(4)).docs[first.docId], original);
  assert.equal(imports, 0);
  assert.deepEqual(errors, []);
  console.log(
    "Blank resume browser checks passed: direct creation, empty fields, separate documents, unique names, existing data preservation, page preference, import-menu creation, refresh, and mobile.",
  );
} finally {
  await browser.close();
}
