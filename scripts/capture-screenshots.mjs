// All records below are fictional. This script always creates its own database.
import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initialWorkspace, blankResume } from "../lib/initial.ts";
import { saveAssessment } from "../lib/saved-matches.ts";

const directory = await mkdtemp(path.join(tmpdir(), "ai-resume-demo-"));
const output = path.resolve("docs/images");
await mkdir(output, { recursive: true });
const probe = createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const url = `http://127.0.0.1:${port}`;
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
    env: {
      ...process.env,
      RESUME_BUILDER_DATA_DIR: directory,
      ENABLE_LOCAL_AI_SUBSCRIPTIONS: "false",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
server.stdout.on("data", (chunk) => {
  logs = (logs + chunk).slice(-3000);
});
server.stderr.on("data", (chunk) => {
  logs = (logs + chunk).slice(-3000);
});
let browser;
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (server.exitCode !== null)
      throw new Error(`Demo server stopped: ${logs}`);
    try {
      if ((await fetch(url)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`Demo server did not start: ${logs}`);
  const state = await (await fetch(url + "/api/storage")).json();
  if (state.workspace.templates.length || state.workspace.jobs.length)
    throw new Error("Refusing to replace a populated database.");
  const doc = {
    ...blankResume(),
    pageCount: 1,
    name: "Alex Morgan",
    headline: "Full Stack Software Engineer",
    contact: "alex.morgan@example.com · Montréal, Canada · example.com/alex",
    summary:
      "Software engineer creating accessible interfaces and dependable backend systems. Experienced in TypeScript, React, and practical automation, with a focus on clear user experiences and reliable data.",
    roles: [
      {
        title: "Software Engineer",
        company: "Example Product Studio",
        dates: "2023 – Present",
        bullets: [
          "Built React and TypeScript workspaces that simplify document-heavy workflows.",
          "Designed SQLite persistence with revision checks and recoverable backups.",
          "Added Playwright coverage for critical editing and recovery flows.",
        ],
      },
      {
        title: "Frontend Developer",
        company: "Example Digital",
        dates: "2021 – 2023",
        bullets: [
          "Shipped responsive interfaces with keyboard navigation and reusable components.",
          "Partnered with designers to simplify onboarding and application flows.",
        ],
      },
    ],
    skills:
      "TypeScript · React · Next.js · Node.js · SQLite · Playwright · Git",
    edu: [
      {
        degree: "BSc, Computer Science",
        school: "Example University",
        dates: "2017 – 2021",
      },
    ],
  };
  const frontend = {
    ...doc,
    headline: "Frontend Engineer",
    summary:
      "Frontend engineer building accessible React applications and reusable interface systems. Brings thoughtful interaction design, TypeScript expertise, and reliable browser testing to product teams.",
    skills:
      "React · TypeScript · CSS · Accessibility · Design systems · Playwright",
  };
  const tailored = {
    ...doc,
    summary:
      "Full stack engineer building accessible React and TypeScript products with dependable local data. Combines hands-on SQLite persistence, practical automation, and Playwright testing to deliver reliable workflows.",
  };
  const templates = [
    {
      id: "fullstack",
      docId: "t:fullstack",
      name: "Full_Stack_Engineer",
      sourceFile: "alex-full-stack.pdf",
      source: "Created locally",
    },
    {
      id: "frontend",
      docId: "t:frontend",
      name: "Frontend_Engineer",
      sourceFile: "alex-frontend.pdf",
      source: "Created locally",
    },
  ];
  const makeJob = (
    id,
    company,
    title,
    templateId,
    status,
    pct,
    terms,
    missing,
  ) => {
    const base = templateId === "frontend" ? frontend : doc;
    const keywords = terms.map((term) => ({
      term,
      category: "Tools",
      required: term !== missing,
    }));
    const job = {
      id,
      company,
      title,
      templateId,
      status,
      location: "Remote · Canada",
      source: "Pasted description",
      url: `https://example.com/jobs/${id}`,
      rawDescription: `Fictional demo posting: join ${company} to build accessible applications using ${terms.join(", ")}. Collaborate with product and design teams to ship reliable software.`,
      keywords,
      ...(id === "northstar" ? { tailoredDocId: "j:northstar" } : {}),
    };
    const resume = id === "northstar" ? tailored : base;
    const items = keywords.map((keyword, keywordIndex) => ({
      ...keyword,
      keywordIndex,
      kind: "technology",
      matched: keyword.term !== missing,
      count: keyword.term === missing ? 0 : 1,
      evidence: keyword.term === missing ? "" : resume.skills,
      reason:
        keyword.term === missing
          ? `No supporting evidence for ${keyword.term} in this resume.`
          : `${keyword.term} is supported by the listed skills and relevant work experience.`,
    }));
    const result = {
      pct,
      summary:
        "Illustrative demo assessment. Strong alignment with the product stack; add concrete evidence for the missing skill if you have relevant experience.",
      matched: items.filter((i) => i.matched).length,
      required: keywords.filter((k) => k.required).length,
      requiredMatched: items.filter((i) => i.matched && i.required).length,
      items,
    };
    const assessment = saveAssessment(
      {
        method: "subscription",
        provider: "openai",
        model: "Illustrative demo",
      },
      job,
      resume,
      result,
    );
    return { ...job, assessment };
  };
  const jobs = [
    makeJob(
      "northstar",
      "Example Northstar",
      "Senior Full Stack Engineer",
      "fullstack",
      "to-apply",
      86,
      ["TypeScript", "React", "Node.js", "SQLite", "Playwright", "Kubernetes"],
      "Kubernetes",
    ),
    makeJob(
      "pixel",
      "Example Pixel Studio",
      "Frontend Engineer",
      "frontend",
      "applied",
      91,
      ["React", "TypeScript", "CSS", "Accessibility", "Playwright", "GraphQL"],
      "GraphQL",
    ),
    makeJob(
      "harbor",
      "Example Harbor",
      "Product Engineer",
      "fullstack",
      "to-apply",
      78,
      ["React", "Next.js", "Node.js", "Git", "PostgreSQL"],
      "PostgreSQL",
    ),
    makeJob(
      "orbit",
      "Example Orbit",
      "Platform Developer",
      "fullstack",
      "rejected",
      68,
      ["TypeScript", "Node.js", "Git", "Terraform"],
      "Terraform",
    ),
  ];
  const workspace = {
    ...initialWorkspace(),
    templates,
    docs: {
      "t:fullstack": doc,
      "t:frontend": frontend,
      "j:northstar": tailored,
    },
    jobs,
    selectedJobId: "northstar",
    notes: [
      {
        id: "note-1",
        text: "Highlight reliable storage, accessible interfaces, and browser testing.",
        createdAt: new Date().toISOString(),
      },
      {
        id: "note-2",
        text: "Prepare a walkthrough of the backup and recovery workflow.",
        createdAt: new Date().toISOString(),
      },
    ],
  };
  async function put(endpoint, body) {
    const response = await fetch(url + endpoint, {
      method: "PUT",
      headers: { origin: url, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(`Demo save failed: ${await response.text()}`);
    return response.json();
  }
  await put("/api/storage", {
    workspace,
    preferredPages: 1,
    revision: state.revision,
  });
  const chatState = await (
    await fetch(url + "/api/storage/chats?scope=job:northstar")
  ).json();
  await put("/api/storage/chats", {
    scope: "job:northstar",
    revision: chatState.revision,
    generation: state.generation,
    messages: [
      {
        role: "user",
        content: "How can I make this resume stronger for the full stack role?",
      },
      {
        role: "assistant",
        content:
          "Your experience already supports **React, TypeScript, SQLite, and automated testing**.\n\nFor this application, I would focus on three things:\n\n1. Lead with the document workflow you built and the problem it solved.\n2. Connect revision checks and recoverable backups to dependable product behavior.\n3. Keep the Playwright example to show how you protect critical user flows.\n\n**Kubernetes is a gap.** Add it only if you can support it with real experience.\n\nYour tailored summary already brings the strongest relevant work forward.",
      },
    ],
  });
  browser = await chromium.launch({
    executablePath:
      process.env.BROWSER_EXECUTABLE_PATH ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined),
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/\/api\/(?:ai|chat|match|jobs)(?:\/|\?|$)/, (route) =>
    route.abort(),
  );
  await page.goto(url);
  await expect(
    page.getByText("Saved on this computer", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".resume-name")).toHaveText("Alex Morgan");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(output, "workspace.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: /AI chat/ }).click();
  await expect(
    page.getByText(
      "How can I make this resume stronger for the full stack role?",
      { exact: true },
    ),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(output, "ai-chat.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Resume match", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator(".resume-name")).toHaveText("Alex Morgan");
  await page.screenshot({
    path: path.join(output, "mobile-resume.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "Toggle templates and jobs panel",
      exact: true,
    })
    .click();
  await page.screenshot({
    path: path.join(output, "mobile-jobs.png"),
    fullPage: true,
  });
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  await browser.close();
  browser = undefined;
  console.log(`Screenshots saved in ${output}`);
  console.log(`DEMO_URL=${url}`);
  console.log(
    "Two fictional resumes, four fictional jobs, a tailored copy, saved illustrative assessments, and a scripted chat. No AI calls made.",
  );
  if (process.argv.includes("--keep-open")) {
    console.log("Demo server remains available until this process is stopped.");
    await new Promise((resolve) => {
      process.once("SIGTERM", resolve);
      process.once("SIGINT", resolve);
      server.once("exit", resolve);
    });
  }
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        server.kill("SIGKILL");
        resolve();
      }, 3000);
      server.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  await rm(directory, { recursive: true, force: true });
}
