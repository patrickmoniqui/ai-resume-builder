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
    "resume-builder.workspace.v1",
    JSON.stringify({
      templates: [
        {
          id: "base",
          docId: "t:base",
          name: "Resume",
          sourceFile: "",
          source: "Blank resume",
        },
      ],
      docs: {
        "t:base": {
          name: "Original",
          headline: "",
          contact: "",
          summary: "Summary",
          skills: "",
          roles: [],
          edu: [],
        },
      },
      jobs: [],
      notes: [],
      references: [],
      selectedJobId: null,
      viewTemplateId: "base",
    }),
  );
});

const name = page.locator('[data-resume-field="name"]');
const value = () =>
  name.evaluate((element) =>
    element instanceof HTMLTextAreaElement
      ? element.value
      : element.textContent,
  );
const expectName = (expected) => expect.poll(value).toBe(expected);
const typeName = async (text) => {
  await page.getByRole("button", { name: "Edit name", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Edit name", exact: true })
    .press("End");
  await page.keyboard.type(text);
};

try {
  await page.goto(process.env.TEST_BASE_URL || "http://127.0.0.1:3000");
  await page.getByText("Saved on this device", { exact: true }).waitFor();

  // Undo while editing, then redo after focus moves outside the field.
  await typeName(" changed");
  await page.keyboard.press("Meta+z");
  const undone = await value();
  assert.notEqual(undone, "Original changed");
  await page.locator(".brand").click();
  await page.keyboard.press("Meta+Shift+z");
  await expectName("Original changed");

  // All supported shortcuts share the same history, including a focused editor.
  for (const [undo, redo] of [
    ["Meta+z", "Meta+Shift+z"],
    ["Meta+z", "Meta+y"],
    ["Control+z", "Control+Shift+z"],
    ["Control+z", "Control+y"],
  ]) {
    await typeName(" again");
    await page.keyboard.press(undo);
    await expectName("Original changed");
    await page.getByRole("button", { name: "Edit name", exact: true }).click();
    await page.keyboard.press(redo);
    await expectName("Original changed again");
    await page.keyboard.press(undo);
    await expectName("Original changed");
  }

  // A new edit after undo discards redo; unrelated inputs retain native history.
  await typeName(" new branch");
  await page
    .getByRole("textbox", { name: "Edit name", exact: true })
    .press("Enter");
  await page.keyboard.press("Meta+Shift+z");
  await expectName("Original changed new branch");
  await page.getByRole("button", { name: /^Notes/ }).click();
  const note = page.getByRole("textbox", {
    name: "Add a quick note",
    exact: true,
  });
  await note.click();
  await page.keyboard.type("Draft note");
  await page.keyboard.press("Meta+z");
  await expectName("Original changed new branch");
  assert.notEqual(await note.inputValue(), "Draft note");
  await page.keyboard.press("Meta+Shift+z");
  await expect(note).toHaveValue("Draft note");

  assert.deepEqual(errors, []);
  console.log(
    "Resume history browser checks passed: focused edits, focus changes, Mac/Windows shortcuts, new branches, and native note undo/redo.",
  );
} finally {
  await browser.close();
}
