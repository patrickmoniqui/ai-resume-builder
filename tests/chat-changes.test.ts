import test from "node:test";
import assert from "node:assert/strict";
import {
  applyChatChange,
  chatChangeState,
  chatEditSchema,
  prepareChatChanges,
  type ChatEdit,
} from "../lib/chat-changes";
import { blankResume, initialWorkspace } from "../lib/initial";
import { newResumeHistory, resumeHistoryReducer } from "../lib/resume-history";
import { loadChatHistory, saveChatHistory } from "../lib/chat-history";
import type { Workspace } from "../lib/model";

function workspace(): Workspace {
  return {
    ...initialWorkspace(),
    templates: [
      {
        id: "base",
        name: "Engineering",
        docId: "t:base",
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
            title: "Engineer",
            company: "Acme",
            dates: "2020–2024",
            bullets: ["Built React applications."],
          },
        ],
        edu: [{ degree: "BSc", school: "University", dates: "2020" }],
        extraSections: [{ title: "Projects", text: "Created a dashboard." }],
      },
    },
    jobs: ["first", "second"].map((id) => ({
      id,
      templateId: "base",
      company: id,
      title: "Engineer",
      location: "Remote",
      source: "Pasted",
      rawDescription: "Build React apps",
      keywords: [{ term: "React", required: true, category: "Tools" }],
    })),
    selectedJobId: "first",
  };
}
const edit = (
  field = "summary",
  before = "Built React applications.",
  after = "React engineer with application development experience.",
): ChatEdit => ({
  field,
  before,
  after,
  reason: "Make the documented experience clearer.",
});

test("job chat changes fork a tailored resume without altering shared templates or other jobs", () => {
  const original = workspace();
  const [change] = prepareChatChanges(original, [edit()]);
  assert.equal(change.target.kind, "job");
  assert.equal(change.target.id, "first");
  assert.equal(chatChangeState(original, change).state, "ready");
  const next = applyChatChange(original, change);
  assert.equal(next.jobs[0].tailoredDocId, "j:first");
  assert.equal(next.docs["j:first"].summary, change.after);
  assert.deepEqual(next.docs["t:base"], original.docs["t:base"]);
  assert.equal(next.jobs[1].tailoredDocId, undefined);
  assert.equal(chatChangeState(next, change).state, "applied");
  assert.equal(applyChatChange(next, change), next);
});

test("template chat changes explicitly edit the selected template", () => {
  const original = workspace();
  original.viewTemplateId = "base";
  const [change] = prepareChatChanges(original, [edit()]);
  assert.equal(change.target.kind, "template");
  const next = applyChatChange(original, change);
  assert.equal(next.docs["t:base"].summary, change.after);
  assert.equal(next.jobs[0].tailoredDocId, undefined);
});

test("multiple field changes remain applicable after the first job edit creates a fork", () => {
  const original = workspace();
  const [summary, headline] = prepareChatChanges(original, [
    edit(),
    edit("headline", "Engineer", "React Engineer"),
  ]);
  const next = applyChatChange(applyChatChange(original, summary), headline);
  assert.equal(next.docs["j:first"].headline, "React Engineer");
  assert.equal(next.docs["j:first"].summary, summary.after);
});

test("chat changes replace existing bullets, append new bullets, and edit education and extra sections", () => {
  let current = workspace();
  const edits = [
    edit(
      "roles.0.bullets.0",
      "Built React applications.",
      "Developed applications using React.",
    ),
    edit(
      "roles.0.bullets.1",
      "",
      "Built the dashboard documented in Projects.",
    ),
    edit("edu.0.degree", "BSc", "Bachelor of Science"),
    edit(
      "extraSections.0.text",
      "Created a dashboard.",
      "Created an application dashboard.",
    ),
  ];
  const changes = prepareChatChanges(current, edits);
  assert.equal(changes.length, 4);
  for (const change of changes) current = applyChatChange(current, change);
  const doc = current.docs["j:first"];
  assert.deepEqual(doc.roles[0].bullets, [edits[0].after, edits[1].after]);
  assert.equal(doc.edu[0].degree, edits[2].after);
  assert.equal(doc.extraSections?.[0].text, edits[3].after);
});

test("stale fields, moved roles, changed template bindings, and different selections block application", () => {
  const original = workspace();
  const [change] = prepareChatChanges(original, [edit()]);
  const modified = structuredClone(original);
  modified.docs["t:base"].summary = "Manually revised summary.";
  assert.equal(chatChangeState(modified, change).state, "stale");
  assert.equal(applyChatChange(modified, change), modified);
  const switched = { ...original, selectedJobId: "second" };
  assert.equal(applyChatChange(switched, change), switched);
  const templateView = { ...original, viewTemplateId: "base" };
  assert.equal(applyChatChange(templateView, change), templateView);
  const rebound = structuredClone(original);
  rebound.jobs[0].templateId = "other";
  assert.equal(applyChatChange(rebound, change), rebound);
  const [bullet] = prepareChatChanges(original, [edit("roles.0.bullets.0")]);
  modified.docs["t:base"].roles[0].company = "Another employer";
  assert.equal(applyChatChange(modified, bullet), modified);
});

test("invalid fields, wrong originals, duplicate edits, unchanged text, and oversized results are excluded", () => {
  const original = workspace();
  const changes = prepareChatChanges(original, [
    edit(),
    edit(),
    edit("summary", "wrong original", "replacement"),
    edit("name", "Applicant", "x".repeat(301)),
    edit("roles.0.bullets.5", "", "Skipped index"),
    edit("roles.0.title", "Engineer", "Engineer"),
    edit("__proto__.polluted", "", "Unsafe"),
    edit("roles.30.title", "", "Outside bounds"),
  ]);
  assert.equal(changes.length, 1);
  assert.equal(
    chatEditSchema.safeParse(edit("__proto__.polluted")).success,
    false,
  );
  const noResume = initialWorkspace();
  assert.deepEqual(prepareChatChanges(noResume, [edit()]), []);
  const [dismissed] = changes;
  assert.equal(
    applyChatChange(original, { ...dismissed, status: "dismissed" }),
    original,
  );
});

test("applying a chat change participates in undo and redo, including fork creation", () => {
  const original = workspace();
  const [change] = prepareChatChanges(original, [edit()]);
  const applied = resumeHistoryReducer(newResumeHistory(original), {
    type: "edit",
    change: (state) => applyChatChange(state, change),
  });
  const undone = resumeHistoryReducer(applied, { type: "undo" });
  assert.deepEqual(undone.present.docs, original.docs);
  assert.equal(undone.present.jobs[0].tailoredDocId, undefined);
  assert.equal(chatChangeState(undone.present, change).state, "ready");
  const redone = resumeHistoryReducer(undone, { type: "redo" });
  assert.deepEqual(redone.present, applied.present);
});

test("proposed changes, diffs, and dismissal status survive saved chat restoration", () => {
  const [change] = prepareChatChanges(workspace(), [edit()]);
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) || null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  const history = [
    {
      role: "assistant" as const,
      content: "Suggested improvement",
      changes: [{ ...change, status: "dismissed" as const }],
    },
  ];
  assert.equal(saveChatHistory(storage, "job:first", history), true);
  assert.deepEqual(loadChatHistory(storage, "job:first"), history);
});
