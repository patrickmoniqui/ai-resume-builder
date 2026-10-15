import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
const artifacts = path.resolve("test-results");
await fs.mkdir(artifacts, { recursive: true });
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
page.on("pageerror", (e) => errors.push(e.message));
try {
  let matchRequests = 0;
  const waitForAssessment = () =>
    page.waitForFunction(() =>
      Array.from(document.querySelectorAll("button")).some(
        (button) =>
          button.textContent.trim() === "Reassess with AI" && !button.disabled,
      ),
    );
  let failNextMatch = false;
  let stallNextMatch = false;
  let streamNextMatch = false;
  await page.route("**/api/match", (route) => {
    matchRequests++;
    if (stallNextMatch) {
      stallNextMatch = false;
      return;
    }
    if (failNextMatch) {
      failNextMatch = false;
      return route.fulfill({
        status: 429,
        json: { error: "AI assessment limit reached. Retry." },
      });
    }
    const { doc, job, connection } = route.request().postDataJSON();
    assert.ok(connection);
    const items = job.keywords.map((k, keywordIndex) => ({
      ...k,
      keywordIndex,
      kind: ["TypeScript", "SQL", "Python"].includes(k.term)
        ? "language"
        : k.category === "Soft skills"
          ? "behavior"
          : "technology",
      matched: k.term === "React" || doc.skills.includes(k.term),
      count: k.term === "React" || doc.skills.includes(k.term) ? 1 : 0,
      evidence:
        k.term === "React"
          ? doc.roles[0]?.bullets[0] || doc.summary || doc.skills
          : doc.skills.includes(k.term)
            ? k.term
            : "",
      reason:
        k.term === "React"
          ? "Documented frontend work provides relevant support."
          : doc.skills.includes(k.term)
            ? "Listed in the resume; strengthen with a work example."
            : "No supporting evidence in the resume.",
    }));
    const result = {
      pct: 73,
      summary:
        "AI recognizes relevant frontend experience; cloud evidence is missing.",
      items,
      matched: items.filter((i) => i.matched).length,
      required: items.filter((i) => i.required).length,
      requiredMatched: items.filter((i) => i.required && i.matched).length,
    };
    if (streamNextMatch) {
      streamNextMatch = false;
      return route.fulfill({
        contentType: "application/x-ndjson",
        body:
          JSON.stringify({
            type: "progress",
            completed: 0,
            total: items.length,
            batch: 1,
            batches: 1,
            repairing: false,
          }) +
          "\n" +
          JSON.stringify({ type: "result", data: result }) +
          "\n",
      });
    }
    return route.fulfill({ json: result });
  });
  await page.goto(process.env.TEST_BASE_URL || "http://localhost:3000");
  await page.getByText("Saved on this device", { exact: true }).waitFor();
  await page
    .getByRole("heading", { name: "Start with your current resume" })
    .waitFor();
  const leftResize = page.getByRole("separator", {
    name: "Resize templates and jobs panel",
    exact: true,
  });
  const rightResize = page.getByRole("separator", {
    name: "Resize right tools panel",
    exact: true,
  });
  const resizeBy = async (handle, delta) => {
    const box = await handle.boundingBox();
    const x = box.x + box.width / 2,
      y = box.y + 100;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + delta, y, { steps: 6 });
    await page.mouse.up();
  };
  const leftInitial = (await page.locator(".left-panel").boundingBox()).width;
  const rightInitial = (await page.locator(".right-panel").boundingBox()).width;
  await resizeBy(leftResize, 80);
  await resizeBy(rightResize, -70);
  assert.ok(
    Math.abs(
      (await page.locator(".left-panel").boundingBox()).width -
        leftInitial -
        80,
    ) < 2,
  );
  assert.ok(
    Math.abs(
      (await page.locator(".right-panel").boundingBox()).width -
        rightInitial -
        70,
    ) < 2,
  );
  await leftResize.focus();
  await page.keyboard.press("ArrowRight");
  const savedLeftWidth = (await page.locator(".left-panel").boundingBox())
    .width;
  const savedRightWidth = (await page.locator(".right-panel").boundingBox())
    .width;
  await page
    .getByRole("button", {
      name: "Toggle templates and jobs panel",
      exact: true,
    })
    .click();
  assert.equal(await leftResize.count(), 0);
  await page
    .getByRole("button", {
      name: "Toggle templates and jobs panel",
      exact: true,
    })
    .click();
  assert.ok(
    Math.abs(
      (await page.locator(".left-panel").boundingBox()).width - savedLeftWidth,
    ) < 2,
  );
  await page.reload();
  await page.getByText("Saved on this device", { exact: true }).waitFor();
  assert.ok(
    Math.abs(
      (await page.locator(".left-panel").boundingBox()).width - savedLeftWidth,
    ) < 2,
  );
  assert.ok(
    Math.abs(
      (await page.locator(".right-panel").boundingBox()).width -
        savedRightWidth,
    ) < 2,
  );
  await page.screenshot({ path: path.join(artifacts, "resizable-panels.png") });
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.waitForTimeout(100);
  assert.ok((await page.locator(".center-panel").boundingBox()).width >= 319);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  const narrowLeft = (await page.locator(".left-panel").boundingBox()).width;
  const narrowRight = (await page.locator(".right-panel").boundingBox()).width;
  await resizeBy(leftResize, -20);
  assert.ok(
    Math.abs(
      (await page.locator(".left-panel").boundingBox()).width - narrowLeft + 20,
    ) < 2,
  );
  assert.ok(
    Math.abs(
      (await page.locator(".right-panel").boundingBox()).width - narrowRight,
    ) < 2,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await leftResize.dblclick();
  await rightResize.dblclick();
  assert.ok(
    Math.abs((await page.locator(".left-panel").boundingBox()).width - 272) < 2,
  );
  assert.ok(
    Math.abs((await page.locator(".right-panel").boundingBox()).width - 320) <
      2,
  );
  assert.equal(
    await page.getByRole("button", { name: "Undo", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "Redo", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: /LinkedIn/i }).count(),
    0,
  );
  assert.equal(await page.locator(".template-row").count(), 0);
  assert.equal(await page.locator(".job-card").count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Export PDF", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "AI chatbot", exact: true }).click();
  await page
    .getByRole("button", { name: "Connect AI for chat", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Instructions", exact: true }).click();
  await page
    .getByLabel("Chat instructions / system prompt", { exact: true })
    .fill("Reply in French and keep answers concise.");
  await page
    .getByRole("button", { name: "Save instructions", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Instructions saved on this device" })
    .waitFor();
  await page.getByRole("button", { name: "Back to chat", exact: true }).click();
  await page
    .getByRole("button", { name: "Close AI chatbot", exact: true })
    .click();
  const pages = page.getByRole("combobox", {
    name: "Resume page count",
    exact: true,
  });
  assert.equal(await pages.inputValue(), "1");
  await pages.selectOption("2");
  await page.reload();
  await page.getByText("Saved on this device", { exact: true }).waitFor();
  assert.equal(await pages.inputValue(), "2");
  await page.getByRole("button", { name: "Connect AI", exact: true }).click();
  await page.getByLabel("API key", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Subscription", exact: true }).click();
  assert.equal(await page.getByLabel("API key", { exact: true }).count(), 0);
  await page.getByRole("button", { name: /Codex OpenAI/ }).click();
  assert.ok(
    (await page.getByRole("dialog").innerText()).includes("codex login"),
  );
  await page.route("**/api/ai/subscription", (route) =>
    route.fulfill({
      json: {
        installed: true,
        authenticated: false,
        message:
          "Run codex login on this computer and sign in with ChatGPT, then check again.",
      },
    }),
  );
  await page
    .getByRole("button", { name: "Connect subscription", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Run codex login" })
    .waitFor();
  assert.equal(await page.locator(".connected-dot").count(), 0);
  await page.unroute("**/api/ai/subscription");
  await page.route("**/api/ai/subscription", (route) =>
    route.fulfill({
      json: {
        installed: true,
        authenticated: true,
        message: "Codex is signed in with ChatGPT.",
      },
    }),
  );
  await page
    .getByRole("button", { name: "Connect subscription", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Codex · Subscription", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Codex · Subscription", exact: true })
    .click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.unroute("**/api/ai/subscription");
  for (const provider of ["openai", "anthropic"]) {
    const origin = new URL(page.url()).origin;
    const result = await page.request.post(origin + "/api/ai/subscription", {
      headers: { Origin: origin },
      data: { provider },
    });
    assert.equal(result.status(), 200);
    const status = await result.json();
    assert.equal(typeof status.authenticated, "boolean");
    assert.equal(typeof status.installed, "boolean");
  }
  await page
    .locator("input[data-upload=resume]")
    .setInputFiles(path.resolve("tests/fixtures/resume.docx"));
  await page.getByRole("button", { name: "Edit name", exact: true }).waitFor();
  assert.equal(await page.locator(".resume-name").innerText(), "Jane Smith");
  const companyBox = await page
    .locator(".experience-company-name")
    .first()
    .boundingBox();
  const directRoleBox = await page.locator(".role-title").first().boundingBox();
  assert.ok(Math.abs(directRoleBox.x - companyBox.x) <= 2);

  assert.equal(await pages.inputValue(), "2");
  await pages.selectOption("1");
  await pages.selectOption("2");
  await page.reload();
  await page.getByText("Saved on this device", { exact: true }).waitFor();
  assert.equal(await pages.inputValue(), "2");
  await page.getByRole("button", { name: "Edit name", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Edit name", exact: true })
    .fill("Jane Taylor");
  await page
    .getByRole("textbox", { name: "Edit name", exact: true })
    .press("Enter");
  const undo = {
    click: async () => {
      await page.locator(".brand").click();
      await page.keyboard.press("Control+z");
    },
  };
  const redo = {
    click: async () => {
      await page.locator(".brand").click();
      await page.keyboard.press("Control+Shift+z");
    },
  };
  await undo.click();
  assert.equal(await page.locator(".resume-name").innerText(), "Jane Smith");
  await redo.click();
  assert.equal(await page.locator(".resume-name").innerText(), "Jane Taylor");
  await page.keyboard.press("Control+z");
  assert.equal(await page.locator(".resume-name").innerText(), "Jane Smith");
  await page.keyboard.press("Control+Shift+z");
  assert.equal(await page.locator(".resume-name").innerText(), "Jane Taylor");
  await page.keyboard.press("Meta+z");
  await page.keyboard.press("Meta+Shift+z");
  assert.equal(await page.locator(".resume-name").innerText(), "Jane Taylor");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+y");
  assert.equal(await page.locator(".resume-name").innerText(), "Jane Taylor");
  await page.getByRole("button", { name: "Edit name", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Edit name", exact: true })
    .fill("Temporary name");
  await undo.click();
  assert.equal(await page.locator(".resume-name").innerText(), "Jane Taylor");
  await redo.click();
  assert.equal(
    await page.locator(".resume-name").innerText(),
    "Temporary name",
  );
  await undo.click();
  await undo.click();
  await page.getByRole("button", { name: "Edit name", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Edit name", exact: true })
    .fill("Jane T");
  await page
    .getByRole("textbox", { name: "Edit name", exact: true })
    .fill("Jane Taylor");
  await page
    .getByRole("textbox", { name: "Edit name", exact: true })
    .press("Enter");
  await redo.click();
  assert.equal(await page.locator(".resume-name").innerText(), "Jane Taylor");
  await pages.selectOption("1");
  await undo.click();
  assert.equal(await pages.inputValue(), "2");
  await redo.click();
  assert.equal(await pages.inputValue(), "1");
  await undo.click();
  assert.equal(await pages.inputValue(), "2");
  await page.reload();
  await page.getByText("Saved on this device", { exact: true }).waitFor();
  assert.equal(await page.locator(".resume-name").innerText(), "Jane Taylor");
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await page.locator(".template-row").nth(1).waitFor();
  assert.equal(await page.locator(".template-row").count(), 2);
  assert.equal(await pages.inputValue(), "2");
  await page.getByRole("button", { name: "Edit name", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Edit name", exact: true })
    .fill("Alternate Resume Applicant");
  await page
    .getByRole("textbox", { name: "Edit name", exact: true })
    .press("Enter");
  await page.getByRole("button", { name: "+ Add job", exact: true }).click();
  await page
    .getByRole("button", { name: "Paste description", exact: true })
    .click();
  await page
    .getByLabel("Job description", { exact: true })
    .fill(
      "Senior Software Engineer\nAcme Labs\nBuild applications. Required: React, TypeScript, SQL, and AWS. Preferred: Docker.",
    );
  await page
    .getByRole("button", { name: "Connect AI to scan job", exact: true })
    .click();
  await page.getByRole("button", { name: "Subscription", exact: true }).click();
  await page.getByRole("button", { name: /Codex OpenAI/ }).click();
  await page.route("**/api/ai/subscription", (route) =>
    route.fulfill({
      json: {
        installed: true,
        authenticated: true,
        message: "Codex is signed in with ChatGPT.",
      },
    }),
  );
  await page
    .getByRole("button", { name: "Connect subscription", exact: true })
    .click();
  assert.ok(
    (
      await page.getByLabel("Job description", { exact: true }).inputValue()
    ).includes("Acme Labs"),
  );
  await page.getByRole("button", { name: "Job link", exact: true }).click();
  await page
    .getByLabel("Job URL", { exact: true })
    .fill("https://jobs.example.com/blocked");
  await page.route("**/api/jobs", (route) =>
    route.fulfill({
      status: 400,
      json: {
        error:
          "This link did not expose a readable job description. Paste it below.",
        code: "JOB_TEXT_UNAVAILABLE",
      },
    }),
  );
  await page
    .getByRole("button", { name: "Scan job with AI", exact: true })
    .click();
  await page.getByRole("alert").filter({ hasText: "did not expose" }).waitFor();
  assert.ok(
    (
      await page.getByLabel("Job description", { exact: true }).inputValue()
    ).includes("Acme Labs"),
  );
  await page.unroute("**/api/jobs");
  let scans = 0;
  await page.route("**/api/jobs", async (route) => {
    scans++;
    const body = route.request().postDataJSON();
    assert.equal(body.connection.method, "subscription");
    assert.equal(body.connection.provider, "openai");
    if (scans === 1)
      return route.fulfill({
        status: 429,
        json: { error: "Provider usage limit reached. Retry the scan." },
      });
    return route.fulfill({
      json: {
        title: "Senior Software Engineer",
        company: "Acme Labs",
        location: "",
        rawDescription: body.description,
        keywords: [
          { term: "React", category: "Hard skills", required: true },
          { term: "TypeScript", category: "Hard skills", required: true },
          { term: "SQL", category: "Hard skills", required: true },
          { term: "AWS", category: "Tools", required: true },
          { term: "Docker", category: "Tools", required: false },
        ],
      },
    });
  });
  await page
    .getByRole("button", { name: "Scan job with AI", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Provider usage limit" })
    .waitFor();
  assert.equal(await page.locator(".job-card").count(), 0);
  await page
    .getByRole("button", { name: "Scan job with AI", exact: true })
    .click();
  await page.getByText("5 keywords found by AI", { exact: true }).waitFor();
  assert.equal(scans, 2);
  assert.equal(matchRequests, 0);
  await page
    .getByRole("button", { name: "Add job and analyze", exact: true })
    .click();
  assert.equal(await page.locator(".job-card").count(), 1);
  const jobStatus = page.getByLabel(
    "Status for Senior Software Engineer at Acme Labs",
    { exact: true },
  );
  await expect(jobStatus).toHaveValue("");
  assert.equal(await page.locator(".job-status-separator").count(), 0);
  await jobStatus.selectOption("to-apply");
  await expect(jobStatus).toHaveValue("to-apply");
  assert.equal(await page.locator(".job-status-separator").count(), 1);
  const statusCompany = page.locator(".job-company-line .company").first();
  const companyPosition = await statusCompany.boundingBox();
  const statusPosition = await jobStatus.boundingBox();
  assert.ok(
    Math.abs(
      companyPosition.y +
        companyPosition.height / 2 -
        statusPosition.y -
        statusPosition.height / 2,
    ) < 2,
  );
  assert.ok(statusPosition.x > companyPosition.x + companyPosition.width);
  assert.ok(statusPosition.x - companyPosition.x - companyPosition.width < 25);
  await page.locator(".score-ring strong").waitFor();
  assert.equal(
    (await page.locator(".score-ring strong").innerText()).replace(/\s/g, ""),
    "73%",
  );
  assert.equal(matchRequests, 1);
  const scoreRing = page.locator(".score-ring");
  const scoreTooltip = page.locator("#match-score-tooltip");
  assert.equal(await scoreTooltip.isVisible(), false);
  await scoreRing.hover();
  assert.equal(await scoreTooltip.isVisible(), true);
  assert.match(
    await scoreTooltip.innerText(),
    /AI recognizes relevant frontend experience; cloud evidence is missing/,
  );
  await page.mouse.move(0, 0);
  assert.equal(await scoreTooltip.isVisible(), false);
  await scoreRing.focus();
  assert.equal(await scoreTooltip.isVisible(), true);
  await scoreRing.evaluate((element) => element.blur());
  assert.equal(
    matchRequests,
    1,
    "Explaining a score uses its saved assessment",
  );
  await page
    .locator(".resume-page")
    .evaluate((element) => (element.style.minHeight = "2200px"));
  await page
    .locator(".document-scroll")
    .evaluate((element) => (element.scrollTop = element.scrollHeight));
  const reactSkill = page
    .locator(".matched-row")
    .filter({ hasText: "React" })
    .locator("summary");
  await reactSkill.click();
  assert.equal(
    await page.evaluate(() =>
      document.activeElement.getAttribute("data-resume-field"),
    ),
    "bullet-0-0",
  );
  assert.equal(
    await page
      .locator('[data-resume-field="bullet-0-0"] mark.focused')
      .innerText(),
    "React",
  );
  assert.ok(await page.locator('[data-resume-field="bullet-0-0"]').isVisible());
  assert.equal(matchRequests, 1);

  await waitForAssessment();
  const savedInitial = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("resume-builder.workspace.v1")).jobs[0]
        .assessment,
  );
  assert.equal(savedInitial.result.pct, 73);
  const beforeReload = matchRequests;
  await jobStatus.selectOption("applied");
  await page.reload();
  await page.getByText("Saved on this device", { exact: true }).waitFor();
  await expect(jobStatus).toHaveValue("applied");
  await jobStatus.selectOption("rejected");
  await expect(page.locator(".job-card").first()).toHaveClass(
    /status-rejected/,
  );
  await jobStatus.selectOption("to-apply");
  await page
    .locator(".job-item")
    .first()
    .screenshot({ path: path.join(artifacts, "job-status.png") });
  await jobStatus.selectOption("");
  await expect(jobStatus).toHaveValue("");
  assert.equal(await page.locator(".job-status-separator").count(), 0);
  await page
    .locator(".job-item")
    .first()
    .screenshot({ path: path.join(artifacts, "job-no-status.png") });
  await page.locator(".score-ring strong").waitFor();
  await page.waitForTimeout(1100);
  assert.equal(matchRequests, beforeReload);
  assert.equal(await page.locator(".assessment-stale").count(), 0);

  assert.deepEqual(
    await page
      .locator('.skill-group[aria-label="Matched"] .skill-term')
      .allTextContents(),
    ["React", "TypeScript", "SQL"],
  );
  assert.ok(
    (
      await page
        .locator('.skill-group[aria-label="Matched"] .skill-term')
        .allTextContents()
    ).includes("React"),
  );
  assert.equal(
    await page.locator(".score-explanation").getAttribute("open"),
    null,
  );
  assert.equal(await page.locator(".ai-card").getAttribute("open"), null);
  await page.screenshot({
    path: path.join(artifacts, "simple-matching-desktop.png"),
  });

  await page.screenshot({ path: path.join(artifacts, "ai-match-desktop.png") });
  failNextMatch = true;
  await page
    .getByRole("button", { name: "Reassess with AI", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "AI assessment limit reached" })
    .waitFor();
  assert.equal(await page.locator(".score-ring").count(), 1);
  await page.locator(".matching-diagnostics summary").click();
  await page.getByText("client: response headers", { exact: true }).waitFor();
  const debugDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download report", exact: true })
    .click();
  const debugDownload = await debugDownloadPromise;
  await debugDownload.saveAs(path.join(artifacts, "matching-debug.json"));
  const debugText = await fs.readFile(
    path.join(artifacts, "matching-debug.json"),
    "utf8",
  );
  const debugReport = JSON.parse(debugText);
  assert.equal(debugReport.status, "error");
  assert.equal(debugReport.input.requirements, 5);
  assert.ok(
    debugReport.events.some(
      (e) => e.stage === "response_headers" && e.details.status === 429,
    ),
  );
  assert.ok(!debugText.includes("Jane Taylor"));
  assert.ok(!debugText.includes("Acme Labs"));
  await page.screenshot({ path: path.join(artifacts, "matching-debug.png") });
  await page
    .getByRole("button", { name: "Reassess with AI", exact: true })
    .click();
  await waitForAssessment();
  await page.locator(".score-ring strong").waitFor();
  stallNextMatch = true;
  await page
    .getByRole("button", { name: "Reassess with AI", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "AI is assessing your resume" })
    .waitFor();
  await page
    .getByRole("button", { name: "Cancel AI assessment", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Assessment canceled" })
    .waitFor();
  assert.equal(
    await page
      .getByRole("status")
      .filter({ hasText: "AI is assessing your resume" })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "Reassess with AI", exact: true })
    .click();
  await waitForAssessment();
  await page.locator(".score-ring strong").waitFor();
  streamNextMatch = true;
  await page
    .getByRole("button", { name: "Reassess with AI", exact: true })
    .click();
  await waitForAssessment();
  await page.locator(".score-ring strong").waitFor();
  assert.equal(
    (await page.locator(".score-ring strong").innerText()).replace(/\s/g, ""),
    "73%",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Run matching diagnostic", exact: true })
      .count(),
    0,
  );
  await page.locator(".matching-diagnostics summary").click();
  const beforeEditMatches = matchRequests;

  await page
    .locator(".missing-row")
    .filter({ hasText: "AWS" })
    .locator("summary")
    .click();
  await page
    .locator(".missing-row")
    .filter({ hasText: "AWS" })
    .getByRole("button", { name: "+ Skills", exact: true })
    .click();
  const addedSkillInput = page.getByRole("textbox", {
    name: "Edit skills",
    exact: true,
  });
  assert.ok((await addedSkillInput.inputValue()).includes("AWS"));
  assert.equal(
    await addedSkillInput.evaluate((input) =>
      input.value.slice(input.selectionStart, input.selectionEnd),
    ),
    "AWS",
  );
  assert.equal(
    await page.evaluate(() =>
      document.activeElement.getAttribute("data-resume-field"),
    ),
    "skills",
  );
  await addedSkillInput.press("Enter");
  assert.equal(
    await page.locator('[data-resume-field="skills"] mark.focused').innerText(),
    "AWS",
  );

  assert.equal(await page.locator(".score-ring").count(), 1);
  await page
    .getByRole("status")
    .filter({ hasText: "Resume or job changed since this assessment" })
    .waitFor();
  await page
    .locator(".missing-row")
    .filter({ hasText: "AWS" })
    .getByRole("button", { name: "+ Skills", exact: true })
    .click();
  assert.equal((await addedSkillInput.inputValue()).split("AWS").length - 1, 1);
  await addedSkillInput.press("Enter");
  await page.waitForTimeout(1100);
  assert.equal(matchRequests, beforeEditMatches);
  assert.equal(
    await page.locator(".missing-row").filter({ hasText: "AWS" }).count(),
    1,
  );
  await page
    .getByRole("button", { name: "Reassess with AI", exact: true })
    .click();
  await waitForAssessment();
  assert.equal(matchRequests, beforeEditMatches + 1);
  assert.equal(await page.locator(".assessment-stale").count(), 0);
  const refreshedAssessment = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("resume-builder.workspace.v1")).jobs[0]
        .assessment,
  );
  assert.ok(
    refreshedAssessment.result.items.find((i) => i.term === "AWS").matched,
  );
  await undo.click();
  assert.ok(
    !(
      await page
        .getByRole("button", { name: "Edit skills", exact: true })
        .innerText()
    ).includes("AWS"),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "View template", exact: true })
      .count(),
    0,
  );
  await redo.click();
  assert.ok(
    (
      await page
        .getByRole("button", { name: "Edit skills", exact: true })
        .innerText()
    ).includes("AWS"),
  );

  await page
    .getByRole("button", { name: "View template", exact: true })
    .click();
  assert.ok(
    !(
      await page
        .getByRole("button", { name: "Edit skills", exact: true })
        .innerText()
    ).includes("AWS"),
  );
  await page.locator(".template-job").first().click();
  await page
    .getByRole("button", { name: "Discard tailoring", exact: true })
    .click();
  assert.ok(
    !(
      await page
        .getByRole("button", { name: "Edit skills", exact: true })
        .innerText()
    ).includes("AWS"),
  );
  await page.getByRole("button", { name: /^Notes/ }).click();
  assert.equal(await page.locator(".note").count(), 0);
  await page
    .getByRole("textbox", { name: "Add a quick note", exact: true })
    .fill("Built production React applications");
  await page
    .getByRole("textbox", { name: "Add a quick note", exact: true })
    .press("Enter");
  assert.equal(await page.locator(".note").count(), 1);
  await page.getByRole("button", { name: "AI chatbot", exact: true }).click();
  let chats = 0;
  await page.route("**/api/chat", (route) => {
    const body = route.request().postDataJSON();
    chats++;
    assert.equal(body.connection.method, "subscription");
    assert.equal(
      body.instructions,
      "Reply in French and keep answers concise.",
    );
    assert.equal(body.workspace.templates.length, 2);
    assert.ok(
      Object.values(body.workspace.docs).some(
        (doc) => doc.name === "Jane Taylor",
      ),
    );
    assert.ok(
      Object.values(body.workspace.docs).some(
        (doc) => doc.name === "Alternate Resume Applicant",
      ),
    );
    assert.equal(body.workspace.jobs[0].company, "Acme Labs");
    assert.ok(
      body.workspace.notes.some(
        (note) => note.text === "Built production React applications",
      ),
    );
    if (chats === 1)
      return route.fulfill({
        status: 429,
        json: { error: "Chat usage limit. Try again." },
      });
    if (chats === 2) {
      assert.equal(body.messages.length, 1);
      return route.fulfill({
        json: {
          reply:
            "Describe the React application you shipped, using only facts from your resume.\n\n## Next steps\n\n- Use **evidence**\n- Include `React`\n\n| Skill | Evidence |\n| --- | --- |\n| React | Application |\n\n```text\nA long code example that should scroll within the reply instead of widening the chat panel.\n```",
        },
      });
    }
    assert.equal(body.messages.length, 3);
    assert.equal(body.messages[1].role, "assistant");
    assert.equal(body.workspace.selectedJobId, body.workspace.jobs[0].id);
    assert.equal(body.workspace.viewTemplateId, null);
    return route.fulfill({
      json: {
        reply:
          'Which outcome can you verify for that application?\n\n<p>Use <strong>verified outcomes</strong>.</p>\n<script>window.chatScriptExecuted = true</script>\n<a href="javascript:alert(1)" onclick="alert(1)">Unsafe link</a>',
      },
    });
  });
  await page
    .getByLabel("Message AI", { exact: true })
    .fill("How should I improve my resume?");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Chat usage limit" })
    .waitFor();
  assert.equal(
    await page.getByLabel("Message AI", { exact: true }).inputValue(),
    "How should I improve my resume?",
  );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByText(
      "Describe the React application you shipped, using only facts from your resume.",
      { exact: true },
    )
    .waitFor();
  await expect(page.locator(".chat-message")).toHaveCount(2);
  await page
    .getByLabel("Message AI", { exact: true })
    .fill("What outcome should I include?");
  await page.getByLabel("Message AI", { exact: true }).press("Enter");
  await page
    .getByText("Which outcome can you verify for that application?", {
      exact: true,
    })
    .waitFor();
  assert.equal(chats, 3);
  assert.equal(await page.locator(".chat-reply h2").innerText(), "Next steps");
  assert.equal(await page.locator(".chat-reply ul li").count(), 2);
  assert.equal(await page.locator(".chat-reply table th").count(), 2);
  assert.equal(await page.locator(".chat-reply pre code").count(), 1);
  assert.equal(
    await page.locator(".chat-reply strong").last().innerText(),
    "verified outcomes",
  );
  assert.equal(
    await page.locator(".chat-reply script, .chat-reply [onclick]").count(),
    0,
  );
  assert.equal(await page.locator(".chat-reply a[href]").count(), 0);
  assert.equal(await page.evaluate(() => window.chatScriptExecuted), undefined);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page
      .locator(".chat-messages")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: path.join(artifacts, "chat-desktop.png") });
  await page
    .getByRole("button", { name: "Close AI chatbot", exact: true })
    .click();
  await page.getByRole("button", { name: "AI chatbot", exact: true }).click();
  await expect(page.locator(".chat-message")).toHaveCount(4);
  await page.locator(".template-row").nth(1).click();
  await expect(page.locator(".chat-message")).toHaveCount(0);
  await page.locator(".job-card").first().click();
  await expect(page.locator(".chat-message")).toHaveCount(4);
  await page.reload();
  await page.getByText("Saved on this device", { exact: true }).waitFor();
  await page.getByRole("button", { name: "AI chatbot", exact: true }).click();
  await expect(page.locator(".chat-message")).toHaveCount(4);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.locator(".chat-message")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Close AI chatbot", exact: true })
    .click();
  await page.locator(".job-card").first().click();
  await page.getByRole("button", { name: "Preview PDF", exact: true }).click();
  await page
    .getByRole("heading", { name: "Resume preview · 2 pages" })
    .waitFor();
  assert.ok(
    (
      await page
        .getByTitle("Resume PDF preview", { exact: true })
        .getAttribute("src")
    ).startsWith("blob:"),
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs(path.join(artifacts, "resume.pdf"));
  assert.equal(
    (await fs.readFile(path.join(artifacts, "resume.pdf"))).toString(
      "utf8",
      0,
      4,
    ),
    "%PDF",
  );
  assert.equal(
    (
      await PDFDocument.load(
        await fs.readFile(path.join(artifacts, "resume.pdf")),
      )
    ).getPageCount(),
    2,
  );
  await page
    .locator("input[data-upload=resume]")
    .setInputFiles(path.join(artifacts, "resume.pdf"));
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(await page.locator(".template-row").count(), 3);
  assert.equal(await pages.inputValue(), "2");
  await page.getByRole("button", { name: "Original PDF", exact: true }).click();
  await page.getByTitle("Original resume PDF", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Extracted text", exact: true })
    .click();
  assert.ok(
    (
      await page.getByLabel("Extracted PDF text", { exact: true }).inputValue()
    ).includes("Jane Taylor"),
  );
  const originalDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Download original PDF", exact: true })
    .click();
  const originalDownload = await originalDownloadPromise;
  await originalDownload.saveAs(path.join(artifacts, "original-resume.pdf"));
  assert.deepEqual(
    await fs.readFile(path.join(artifacts, "original-resume.pdf")),
    await fs.readFile(path.join(artifacts, "resume.pdf")),
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await page.getByText("Saved on this device", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Original PDF", exact: true }).click();
  await page.getByTitle("Original resume PDF", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await pages.selectOption("1");
  const single = await page.request.post(
    new URL(page.url()).origin + "/api/export",
    {
      data: {
        name: "Test",
        headline: "",
        contact: "",
        summary: "Short resume",
        roles: [],
        skills: "",
        edu: [],
        pageCount: 1,
      },
    },
  );
  assert.equal(single.status(), 200);
  assert.equal((await PDFDocument.load(await single.body())).getPageCount(), 1);
  assert.equal(await page.locator(".resume-name").innerText(), "Jane Taylor");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(artifacts, "desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page
    .getByRole("button", { name: "Expand templates and jobs", exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(artifacts, "mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "AI chatbot", exact: true }).click();
  await page.getByLabel("Message AI", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Connect AI for chat", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({ path: path.join(artifacts, "chat-mobile.png") });
  await page
    .getByRole("button", { name: "Close AI chatbot", exact: true })
    .click();
  const rightToolsToggle = page.getByRole("button", {
    name: "Toggle right tools panel",
    exact: true,
  });
  if ((await rightToolsToggle.getAttribute("aria-expanded")) === "true")
    await rightToolsToggle.click();
  await page
    .getByRole("button", {
      name: "Delete current resume template",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog", { name: "Delete resume template", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Expand templates and jobs", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete template resume_copy", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.locator(".template-row").count(), 3);
  await page
    .getByRole("button", { name: "Delete template resume_copy", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete template", exact: true })
    .click();
  assert.equal(await page.locator(".template-row").count(), 2);
  await page
    .getByRole("button", { name: "Delete template resume", exact: true })
    .first()
    .click();
  await page.getByLabel("Replacement template", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Delete template", exact: true })
    .click();
  assert.equal(await page.locator(".template-row").count(), 1);
  assert.equal(await page.locator(".job-card").count(), 1);
  await page.reload();
  await page
    .getByRole("button", { name: "Expand templates and jobs", exact: true })
    .click();
  assert.equal(await page.locator(".template-row").count(), 1);
  assert.equal(await page.locator(".job-card").count(), 1);
  const remainingDelete = page.getByRole("button", {
    name: /^Delete template /,
  });
  await remainingDelete.click();
  await page
    .getByText("Linked jobs will have no base template", { exact: false })
    .waitFor();
  await page
    .getByRole("button", { name: "Delete template", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Start with your current resume" })
    .waitFor();
  assert.equal(await page.locator(".job-card").count(), 1);
  await page.reload();
  await page
    .getByRole("button", { name: "Expand templates and jobs", exact: true })
    .click();
  assert.equal(await page.locator(".template-row").count(), 0);
  assert.equal(await page.locator(".job-card").count(), 1);
  await page
    .getByRole("button", { name: "Import resume", exact: true })
    .click();
  await page.getByRole("button", { name: "Start fresh", exact: true }).click();
  await page
    .getByRole("button", { name: "Clear workspace", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Start with your current resume" })
    .waitFor();
  await page
    .getByRole("button", {
      name: "Toggle templates and jobs panel",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Start with a blank resume", exact: true })
    .click();
  assert.ok(
    (
      await page
        .getByRole("button", { name: "Edit name", exact: true })
        .innerText()
    ).includes("Click to add"),
  );
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("resume-builder.workspace.v1")),
  );
  assert.equal(Object.values(stored.docs)[0].name, "");
  assert.equal(Object.values(stored.docs)[0].summary, "");
  const completePDF = await page.request.post(
    new URL(page.url()).origin + "/api/export",
    {
      data: {
        name: "Resume with all sections",
        headline: "Engineer",
        contact: "",
        summary: "Builds useful tools.",
        roles: [],
        skills: "Python",
        edu: [],
        pageCount: 1,
        extraSections: [
          { title: "Projects", text: "Built Project Beacon." },
          { title: "Languages", text: "French and English" },
          { title: "Certifications", text: "Cloud architecture certificate" },
        ],
      },
    },
  );
  assert.equal(completePDF.status(), 200);
  const completePath = path.join(artifacts, "all-sections.pdf");
  await fs.writeFile(completePath, await completePDF.body());
  await page.locator("input[data-upload=resume]").setInputFiles(completePath);
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(await page.locator(".extra-resume-section").count(), 3);
  assert.ok(
    (await page.locator(".extra-resume-section").first().innerText()).includes(
      "Built Project Beacon.",
    ),
  );
  await page
    .getByRole("button", { name: "Edit extra text", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Edit extra text", exact: true })
    .fill("Built Project Beacon and a data dashboard.");
  await page
    .getByRole("textbox", { name: "Edit extra text", exact: true })
    .press("Tab");
  await page.reload();
  await page.locator(".extra-resume-section").first().waitFor();
  assert.ok(
    (await page.locator(".extra-resume-section").first().innerText()).includes(
      "and a data dashboard.",
    ),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: path.join(artifacts, "pdf-sections.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "AI chatbot", exact: true }).click();
  await page.getByLabel("Message AI", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Instructions", exact: true }).click();
  assert.equal(
    await page
      .getByLabel("Chat instructions / system prompt", { exact: true })
      .inputValue(),
    "Reply in French and keep answers concise.",
  );
  await page.screenshot({
    path: path.join(artifacts, "chat-instructions.png"),
  });
  await page
    .getByRole("button", { name: "Reset to default", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save instructions", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Default instructions restored" })
    .waitFor();
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("resume-builder.chat-instructions.v1"),
    ),
    null,
  );
  await page.getByRole("button", { name: "Back to chat", exact: true }).click();
  await page.unroute("**/api/chat");
  await page.route("**/api/chat", (route) => {
    const body = route.request().postDataJSON();
    assert.equal(body.instructions, "");
    assert.equal(Object.keys(body.workspace.docs).length, 2);
    assert.ok(
      Object.values(body.workspace.docs).some((doc) =>
        doc.extraSections?.[0].text.includes("and a data dashboard."),
      ),
    );
    assert.ok(
      body.sources.some(
        (source) =>
          source.name === "all-sections.pdf" &&
          source.text.includes("Built Project Beacon."),
      ),
    );
    return route.fulfill({
      json: {
        reply: "I can compare the edited project with your original PDF text.",
      },
    });
  });
  await page
    .getByLabel("Message AI", { exact: true })
    .fill("Compare my edited project with the original PDF.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByText(
      "I can compare the edited project with your original PDF text.",
      { exact: true },
    )
    .waitFor();
  await page.screenshot({ path: path.join(artifacts, "chat-workspace.png") });
  await page
    .getByRole("button", { name: "Close AI chatbot", exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "+ Add company", exact: true })
    .click();
  const edit = async (label, value) => {
    const input = page.getByRole("textbox", { name: label, exact: true });
    await input.fill(value);
    await input.press("Enter");
  };
  await edit("Edit role company", "Company A");
  // A company starts without roles; roles are optional.
  assert.equal(await page.locator(".experience-company").count(), 1);
  assert.equal(await page.locator(".role").count(), 0);
  assert.equal(await page.getByText(/team/i).count(), 0);
  for (const title of [
    "Web developer",
    "Senior developer",
    "Tools programmer",
  ]) {
    await page.getByRole("button", { name: "+ Add role", exact: true }).click();
    await edit("Edit role title", title);
  }
  await page
    .getByRole("button", { name: "+ Add bullet", exact: true })
    .first()
    .click();
  await edit("Edit bullet", "Built websites.");
  await page
    .getByRole("button", { name: "Edit role company", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Edit role company", exact: true })
    .fill("");
  await edit("Edit role company", "Renamed Company A");
  await undo.click();
  assert.equal(
    await page
      .getByRole("button", { name: "Edit role company", exact: true })
      .innerText(),
    "Company A",
  );
  await redo.click();
  assert.equal(await page.locator(".experience-company").count(), 1);
  assert.equal(await page.locator(".role").count(), 3);
  const assertNestedExperience = async () => {
    const company = await page
      .locator(".experience-company-name")
      .first()
      .boundingBox();
    const role = await page.locator(".role-title").first().boundingBox();
    const bullet = await page.locator(".role .bullet").first().boundingBox();
    // Company and role share the left edge; bullets are indented slightly.
    assert.ok(Math.abs(role.x - company.x) <= 2);
    assert.ok(bullet.x >= company.x + 8 && bullet.x <= company.x + 24);
  };
  await assertNestedExperience();

  const sectionIds = () =>
    page
      .locator(".resume-section")
      .evaluateAll((elements) =>
        elements.map((e) => e.getAttribute("data-section")),
      );
  const initialSectionOrder = await sectionIds();
  await page.getByRole("button", { name: /^Move Projects up$/i }).click();
  const movedSectionOrder = await sectionIds();
  assert.notDeepEqual(movedSectionOrder, initialSectionOrder);
  await undo.click();
  assert.deepEqual(await sectionIds(), initialSectionOrder);
  await redo.click();
  assert.deepEqual(await sectionIds(), movedSectionOrder);
  await page
    .getByRole("button", { name: "Drag Skills section", exact: true })
    .dragTo(
      page.locator(
        '.resume-section[data-section="summary"] .resume-section-heading',
      ),
    );
  assert.equal((await sectionIds())[0], "skills");
  await undo.click();
  assert.deepEqual(await sectionIds(), movedSectionOrder);
  await redo.click();
  assert.equal((await sectionIds())[0], "skills");
  assert.ok(
    await page
      .getByRole("button", { name: "Move Skills up", exact: true })
      .isDisabled(),
  );

  await page.waitForTimeout(700);
  await page.reload();
  await page.getByText("Saved on this device", { exact: true }).waitFor();
  assert.equal((await sectionIds())[0], "skills");
  const hierarchy = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("resume-builder.workspace.v1")),
  );
  const experience = Object.values(hierarchy.docs).find(
    (d) => d.roles.length === 3,
  ).roles;
  assert.ok(experience.every((r) => r.company === "Renamed Company A"));
  assert.deepEqual(
    experience.map((r) => r.title),
    ["Web developer", "Senior developer", "Tools programmer"],
  );
  assert.ok(experience.every((r) => !("team" in r)));
  await page
    .locator('.resume-section[data-section="experience"]')
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(artifacts, "experience-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page
    .getByRole("button", { name: "Edit role company", exact: true })
    .first()
    .waitFor();
  assert.ok(
    await page
      .getByRole("button", { name: "Edit role company", exact: true })
      .first()
      .isVisible(),
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page
    .getByRole("button", { name: "Move Skills down", exact: true })
    .click();
  assert.equal((await sectionIds())[1], "skills");
  await undo.click();
  assert.equal((await sectionIds())[0], "skills");
  await assertNestedExperience();
  await page
    .locator('.resume-section[data-section="experience"]')
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(artifacts, "experience-mobile.png"),
  });
  await page
    .getByRole("button", { name: "Codex · Subscription", exact: true })
    .click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("resume-builder.ai-connection.v1"),
    ),
    null,
  );
  await page.evaluate(() => {
    const stored = JSON.parse(
      localStorage.getItem("resume-builder.workspace.v1"),
    );
    const template = stored.templates.find(
      (t) => stored.docs[t.docId].roles.length === 3,
    );
    stored.jobs = [
      {
        id: "ai-match-job",
        templateId: template.id,
        title: "Software Engineer",
        company: "Test Employer",
        location: "Remote",
        rawDescription:
          "Build Python services and deploy to AWS. Python and AWS experience are required.",
        keywords: [
          { term: "Python", category: "Tools", required: true },
          { term: "AWS", category: "Tools", required: true },
          { term: "Communication", category: "Soft skills", required: true },
        ],
        source: "Pasted description",
      },
    ];
    stored.selectedJobId = "ai-match-job";
    stored.viewTemplateId = null;
    localStorage.setItem("resume-builder.workspace.v1", JSON.stringify(stored));
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const beforeDisconnected = matchRequests;
  await page.reload();
  await page
    .getByRole("button", { name: "Connect AI for matching", exact: true })
    .waitFor();
  assert.equal(await page.locator(".score-ring").count(), 0);
  assert.equal(matchRequests, beforeDisconnected);
  await page
    .getByRole("button", { name: "Connect AI for matching", exact: true })
    .click();
  await page.getByRole("button", { name: "Subscription", exact: true }).click();
  await page.getByRole("button", { name: /Codex OpenAI/ }).click();
  await page
    .getByRole("button", { name: "Connect subscription", exact: true })
    .click();
  assert.equal(matchRequests, beforeDisconnected);
  await page
    .getByRole("button", { name: "Reassess with AI", exact: true })
    .click();
  await page.locator(".score-ring strong").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.locator(".right-panel").isVisible());
  assert.deepEqual(
    await page
      .locator('.skill-group[aria-label="Missing"] .skill-term')
      .allTextContents(),
    ["AWS", "Communication"],
  );
  await page.screenshot({
    path: path.join(artifacts, "simple-matching-mobile.png"),
  });

  await page.screenshot({ path: path.join(artifacts, "ai-match-mobile.png") });
  const beforeMobileFocus = matchRequests;
  await page
    .locator(".matched-row")
    .filter({ hasText: "Python" })
    .locator("summary")
    .click();
  await expect(page.locator(".right-panel")).toBeHidden();
  assert.equal(await page.locator(".left-panel").count(), 0);
  assert.equal(
    await page.evaluate(() =>
      document.activeElement.getAttribute("data-resume-field"),
    ),
    "skills",
  );
  assert.equal(
    await page.locator('[data-resume-field="skills"] mark.focused').innerText(),
    "Python",
  );
  assert.equal(matchRequests, beforeMobileFocus);

  await page.setViewportSize({ width: 1440, height: 1000 });
  const beforeSettingsChange = matchRequests;
  await page.route("**/api/ai", (route) =>
    route.fulfill({ json: { suggestions: [] } }),
  );
  await page
    .getByRole("button", { name: "Codex · Subscription", exact: true })
    .click();
  await page.getByRole("button", { name: "API key", exact: true }).click();
  await page.getByLabel("API key", { exact: true }).fill("test-api-key");
  await page.getByLabel("Model", { exact: true }).fill("test-model");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "OpenAI · test-model", exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole("button", { name: "OpenAI · test-model", exact: true })
    .waitFor();
  await page.waitForTimeout(1100);
  assert.equal(matchRequests, beforeSettingsChange);
  await page.unroute("**/api/chat");
  await page.route("**/api/chat", (route) => {
    const body = route.request().postDataJSON();
    assert.equal(body.connection.method, "apiKey");
    assert.equal(body.connection.key, "test-api-key");
    assert.equal(body.connection.model, "test-model");
    return route.fulfill({ json: { reply: "Saved API settings are in use." } });
  });
  await page.getByRole("button", { name: "AI chatbot", exact: true }).click();
  await page
    .getByLabel("Message AI", { exact: true })
    .fill("Check the saved connection.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByText("Saved API settings are in use.", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Close AI chatbot", exact: true })
    .click();
  const beforeReferences = matchRequests;
  await page.getByRole("button", { name: /^Notes/ }).click();
  await page.locator('input[data-upload="reference"]').setInputFiles({
    name: "project-reference.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "The applicant built Project Atlas. This is supporting reference material.",
    ),
  });
  await page
    .getByRole("button", { name: "project-reference.txt", exact: true })
    .waitFor();
  await page.locator('input[data-upload="reference"]').setInputFiles({
    name: "supporting-reference.pdf",
    mimeType: "application/pdf",
    buffer: await fs.readFile(path.join(artifacts, "resume.pdf")),
  });
  await page
    .getByRole("button", { name: "supporting-reference.pdf", exact: true })
    .waitFor();
  assert.equal(await page.locator(".reference-row").count(), 2);
  await page
    .getByRole("button", { name: "supporting-reference.pdf", exact: true })
    .click();
  await page
    .getByTitle("Reference PDF: supporting-reference.pdf", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Extracted text", exact: true })
    .click();
  assert.ok(
    (
      await page
        .getByLabel("Reference document text", { exact: true })
        .inputValue()
    ).includes("Jane Taylor"),
  );
  const referenceDownload = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Download original reference", exact: true })
    .click();
  const fileDownload = await referenceDownload;
  await fileDownload.saveAs(path.join(artifacts, "reference-original.pdf"));
  assert.deepEqual(
    await fs.readFile(path.join(artifacts, "reference-original.pdf")),
    await fs.readFile(path.join(artifacts, "resume.pdf")),
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: /^Notes/ }).click();
  await page
    .getByRole("button", { name: "project-reference.txt", exact: true })
    .waitFor();
  assert.equal(await page.locator(".reference-row").count(), 2);
  await page.unroute("**/api/chat");
  await page.route("**/api/chat", (route) => {
    const body = route.request().postDataJSON();
    assert.equal(body.references.length, 2);
    assert.ok(
      body.references.some(
        (r) =>
          r.name === "project-reference.txt" &&
          r.text.includes("Project Atlas"),
      ),
    );
    return route.fulfill({
      json: { reply: "I can use Project Atlas from your reference document." },
    });
  });
  await page.getByRole("button", { name: "AI chatbot", exact: true }).click();
  await page
    .getByLabel("Message AI", { exact: true })
    .fill("What projects are mentioned in my references?");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByText("I can use Project Atlas from your reference document.", {
      exact: true,
    })
    .waitFor();
  await page
    .getByRole("button", { name: "Close AI chatbot", exact: true })
    .click();
  await page.unroute("**/api/ai");
  await page.route("**/api/ai", (route) => {
    const body = route.request().postDataJSON();
    assert.equal(body.mode, "notes");
    assert.equal(body.references.length, 2);
    assert.ok(body.references[0].text.includes("Project Atlas"));
    return route.fulfill({ json: { suggestions: [] } });
  });
  await page
    .getByRole("button", { name: "Apply notes with AI", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Apply notes with AI", exact: true })
    .waitFor();
  await page
    .getByRole("button", {
      name: "Remove reference project-reference.txt",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "project-reference.txt", exact: true })
    .waitFor({ state: "hidden" });
  assert.equal(await page.locator(".reference-row").count(), 1);
  await page.screenshot({
    path: path.join(artifacts, "reference-documents.png"),
  });
  assert.equal(matchRequests, beforeReferences);
  await page
    .getByRole("button", { name: "OpenAI · test-model", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("API key", { exact: true }).inputValue(),
    "test-api-key",
  );
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  const finalMatchCount = matchRequests;
  await page.reload();
  await page.getByRole("button", { name: "Connect AI", exact: true }).waitFor();
  await page.locator(".score-ring strong").waitFor();
  assert.equal(matchRequests, finalMatchCount);
  await page.getByRole("button", { name: /^Notes/ }).click();
  let releaseReference;
  const referenceGate = new Promise((resolve) => {
    releaseReference = resolve;
  });
  await page.route("**/api/references", async (route) => {
    await referenceGate;
    await route.fulfill({
      json: {
        name: "queued-reference.txt",
        type: "txt",
        size: 30,
        text: "A reference from the previous workspace.",
      },
    });
  });
  const pendingReference = page.waitForRequest("**/api/references");
  await page.locator('input[data-upload="reference"]').setInputFiles({
    name: "queued-reference.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("A pending reference."),
  });
  await pendingReference;
  await page
    .getByRole("button", { name: "Import resume", exact: true })
    .click();
  await page.getByRole("button", { name: "Start fresh", exact: true }).click();
  await page
    .getByRole("button", { name: "Clear workspace", exact: true })
    .click();
  releaseReference();
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".reference-row").count(), 0);
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("resume-builder.workspace.v1"))
          .references.length,
    ),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: empty start, real DOCX/PDF imports, edits, persistence, jobs, isolated tailoring, notes, PDF export, blank resume, AI connection methods, page layouts and mobile.",
  );
} catch (e) {
  await page.screenshot({ path: path.join(artifacts, "failure.png") });
  console.log((await page.locator("body").innerText()).slice(-3000));
  throw e;
} finally {
  await browser.close();
}
